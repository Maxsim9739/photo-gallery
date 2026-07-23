const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const app = express();
const path = require('path');
app.set('views', path.join(__dirname, 'views'));
// Используем PORT из переменных окружения для хостинга
const PORT = process.env.PORT || 3000;

// Для продакшена используем secure куки
const isProduction = process.env.NODE_ENV === 'production';

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));
app.set('view engine', 'ejs');

// Session configuration для продакшена
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key-change-this',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: isProduction, // true только на HTTPS
        maxAge: 24 * 60 * 60 * 1000 
    }
}));

// Для Render.com используем временное хранилище или подключаем БД
// ВАЖНО: На бесплатных хостингах файлы могут удаляться при перезапуске!
// Лучше использовать облачное хранилище (Cloudinary, AWS S3 и т.д.)

// Временное хранение в памяти (сбросится при перезапуске сервера)
let photos = [];
let likes = {};

// Настройка multer с проверкой на существование папки
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    fileFilter: (req, file, cb) => {
        const filetypes = /jpeg|jpg|png|gif|webp/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        
        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error('Только изображения разрешены!'));
    },
    limits: { fileSize: 10 * 1024 * 1024 }
});

// Middleware для аутентификации
const requireEditor = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'editor') {
        next();
    } else {
        res.status(403).json({ error: 'Доступ запрещен' });
    }
};

const requireGuest = (req, res, next) => {
    if (!req.session.guestId) {
        req.session.guestId = 'guest_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }
    next();
};

// Главная страница
app.get('/', requireGuest, (req, res) => {
    const userRole = req.session.user ? req.session.user.role : 'guest';
    const photosWithLikes = photos.map(photo => ({
        ...photo,
        likes: likes[photo.id] ? likes[photo.id].length : 0,
        isLiked: likes[photo.id] ? likes[photo.id].includes(req.session.guestId) : false
    }));
    
    res.render('gallery', {
        photos: photosWithLikes,
        userRole: userRole,
        guestId: req.session.guestId
    });
});

// Страница входа
app.get('/login', (req, res) => {
    if (req.session.user) {
        return res.redirect('/');
    }
    res.render('login', { error: null });
});

// Обработка входа
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    
    // Используем переменные окружения для безопасности
    const adminUser = process.env.ADMIN_USER || 'admin';
    const adminPass = process.env.ADMIN_PASS || 'admin123';
    
    if (username === adminUser && password === adminPass) {
        req.session.user = {
            id: 1,
            username: adminUser,
            role: 'editor'
        };
        return res.json({ success: true, redirect: '/' });
    }
    
    res.json({ success: false, error: 'Неверное имя пользователя или пароль' });
});

// Выход
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// Загрузка фото
app.post('/upload', requireEditor, upload.single('photo'), (req, res) => {
    try {
        const { title, description } = req.body;
        const newPhoto = {
            id: photos.length > 0 ? Math.max(...photos.map(p => p.id)) + 1 : 1,
            filename: req.file.filename,
            title: title || 'Без названия',
            description: description || '',
            uploadDate: new Date(),
            likes: 0
        };
        
        photos.push(newPhoto);
        likes[newPhoto.id] = [];
        
        res.json({ success: true, photo: newPhoto });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Удаление фото
app.delete('/photo/:id', requireEditor, (req, res) => {
    const photoId = parseInt(req.params.id);
    const photoIndex = photos.findIndex(p => p.id === photoId);
    
    if (photoIndex === -1) {
        return res.status(404).json({ success: false, error: 'Фото не найдено' });
    }
    
    photos.splice(photoIndex, 1);
    delete likes[photoId];
    
    res.json({ success: true });
});

// Обновление фото
app.put('/photo/:id', requireEditor, (req, res) => {
    const photoId = parseInt(req.params.id);
    const photo = photos.find(p => p.id === photoId);
    
    if (!photo) {
        return res.status(404).json({ success: false, error: 'Фото не найдено' });
    }
    
    const { title, description } = req.body;
    if (title) photo.title = title;
    if (description !== undefined) photo.description = description;
    
    res.json({ success: true, photo: photo });
});

// Лайки
app.post('/photo/:id/like', requireGuest, (req, res) => {
    const photoId = parseInt(req.params.id);
    const guestId = req.session.guestId;
    
    if (!likes[photoId]) {
        likes[photoId] = [];
    }
    
    const likeIndex = likes[photoId].indexOf(guestId);
    
    if (likeIndex > -1) {
        likes[photoId].splice(likeIndex, 1);
        res.json({ success: true, liked: false, likes: likes[photoId].length });
    } else {
        likes[photoId].push(guestId);
        res.json({ success: true, liked: true, likes: likes[photoId].length });
    }
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});