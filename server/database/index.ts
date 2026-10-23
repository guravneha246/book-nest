import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import { config } from '../config/index.js';

if (!fs.existsSync(config.dataDir)) {
  fs.mkdirSync(config.dataDir, { recursive: true });
}

export const db = new Database(config.dbPath);

// Enable WAL mode and foreign keys for high performance and integrity
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDatabase() {
  db.exec(`
    -- 1. Users
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      phone TEXT,
      joined_date TEXT DEFAULT 'August 2024',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 2. Categories
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      description TEXT,
      icon TEXT,
      color TEXT,
      accent_bg TEXT
    );

    -- 3. Authors
    CREATE TABLE IF NOT EXISTS authors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      bio TEXT
    );

    -- 4. Books
    CREATE TABLE IF NOT EXISTS books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      author_id INTEGER NOT NULL REFERENCES authors(id),
      category_id INTEGER NOT NULL REFERENCES categories(id),
      isbn TEXT UNIQUE NOT NULL,
      publisher TEXT,
      publication_year INTEGER,
      pages INTEGER,
      language TEXT DEFAULT 'English',
      description TEXT,
      price REAL NOT NULL DEFAULT 0.0,
      discount REAL NOT NULL DEFAULT 0.0,
      stock INTEGER NOT NULL DEFAULT 0,
      cover_image TEXT,
      rating REAL NOT NULL DEFAULT 5.0,
      views INTEGER DEFAULT 0,
      is_archived INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 5. User Cart Header
    CREATE TABLE IF NOT EXISTS cart (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 6. Cart Items
    CREATE TABLE IF NOT EXISTS cart_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      quantity INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, book_id)
    );

    -- 7. Wishlist
    CREATE TABLE IF NOT EXISTS wishlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, book_id)
    );

    -- 8. Orders
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      order_number TEXT UNIQUE NOT NULL,
      status TEXT NOT NULL DEFAULT 'Confirmed',
      payment_method TEXT NOT NULL,
      payment_status TEXT NOT NULL DEFAULT 'DEMO PAID',
      subtotal REAL NOT NULL,
      discount_amount REAL NOT NULL DEFAULT 0.0,
      delivery_fee REAL NOT NULL DEFAULT 0.0,
      gst_amount REAL NOT NULL DEFAULT 0.0,
      grand_total REAL NOT NULL,
      full_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      hostel_block TEXT NOT NULL,
      room_no TEXT NOT NULL,
      delivery_notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 9. Order Items
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      book_id INTEGER NOT NULL REFERENCES books(id),
      quantity INTEGER NOT NULL DEFAULT 1,
      unit_price REAL NOT NULL,
      line_total REAL NOT NULL
    );

    -- 10. Reviews
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id),
      rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
      title TEXT,
      comment TEXT NOT NULL,
      is_verified INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 11. Delivery Addresses
    CREATE TABLE IF NOT EXISTS addresses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      full_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      hostel_block TEXT NOT NULL,
      room_no TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 12. Book Views Analytics
    CREATE TABLE IF NOT EXISTS book_views (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      viewed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 13. Search History Analytics
    CREATE TABLE IF NOT EXISTS search_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      query TEXT NOT NULL,
      results_count INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 14. Promotional Coupons
    CREATE TABLE IF NOT EXISTS coupons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      discount_type TEXT NOT NULL,
      discount_value REAL NOT NULL,
      min_order_amount REAL NOT NULL DEFAULT 0.0,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    -- Indexes for high-throughput reads and lookups
    CREATE INDEX IF NOT EXISTS idx_books_isbn ON books(isbn);
    CREATE INDEX IF NOT EXISTS idx_books_category ON books(category_id);
    CREATE INDEX IF NOT EXISTS idx_books_author ON books(author_id);
    CREATE INDEX IF NOT EXISTS idx_books_title ON books(title);
    CREATE INDEX IF NOT EXISTS idx_cart_user ON cart_items(user_id);
    CREATE INDEX IF NOT EXISTS idx_wishlist_user ON wishlist(user_id);
    CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
    CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
    CREATE INDEX IF NOT EXISTS idx_reviews_book ON reviews(book_id);
    CREATE INDEX IF NOT EXISTS idx_reviews_user ON reviews(user_id);
    CREATE INDEX IF NOT EXISTS idx_addresses_user ON addresses(user_id);
    CREATE INDEX IF NOT EXISTS idx_book_views_book ON book_views(book_id);
    CREATE INDEX IF NOT EXISTS idx_search_history_user ON search_history(user_id);
  `);

  // Non-destructive migrations for Google OAuth columns on users
  try {
    db.exec('ALTER TABLE users ADD COLUMN google_id TEXT;');
  } catch {}
  try {
    db.exec('ALTER TABLE users ADD COLUMN avatar_url TEXT;');
  } catch {}

  // Safe migration for soft book archiving
  try {
    db.exec('ALTER TABLE books ADD COLUMN is_archived INTEGER DEFAULT 0;');
  } catch {}
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_books_archived ON books(is_archived);');
  } catch {}

  // Seed initial dataset if fresh database
  seedData();

  // Ensure all predefined categories exist
  ensurePredefinedCategories();

  // Ensure full 300+ book catalogue is populated from seed data across all categories
  ensureExpandedCatalogueSeed();

  // Ensure demo accounts exist with valid credentials even if database already existed
  ensureDemoAccounts();

  // Reconcile canonical test fixtures and seed data consistently
  reconcileCanonicalData();
}

export function ensureDemoAccounts() {
  try {
    // 1. Production Safety: Never auto-seed or modify demo accounts in production unless explicitly enabled
    const isProd = (config.nodeEnv || '').toLowerCase() === 'production';
    if (isProd && process.env.ALLOW_DEMO_ACCOUNTS !== 'true') {
      return;
    }

    const adminEmail = 'admin@booknest.com';
    const studentEmail = 'user@booknest.com';
    const adminPasswordHash = bcrypt.hashSync('Admin@123', 10);
    const studentPasswordHash = bcrypt.hashSync('User@123', 10);

    // 2. Ensure Demo Admin exists ONLY if it doesn't already exist.
    // Existing accounts and passwords are strictly preserved to prevent accidental password resets or role elevations.
    const admin = db.prepare('SELECT id, role, password_hash FROM users WHERE email = ?').get(adminEmail) as any;
    if (!admin) {
      db.prepare(`
        INSERT INTO users (name, email, password_hash, role, phone, joined_date)
        VALUES (?, ?, ?, 'admin', ?, 'August 2024')
      `).run('BookNest Administrator', adminEmail, adminPasswordHash, '+91 98765 43210');
    }

    // 3. Ensure Demo Student exists ONLY if it doesn't already exist.
    const student = db.prepare('SELECT id, role, password_hash FROM users WHERE email = ?').get(studentEmail) as any;
    if (!student) {
      db.prepare(`
        INSERT INTO users (name, email, password_hash, role, phone, joined_date)
        VALUES (?, ?, ?, 'user', ?, 'August 2024')
      `).run('Aditya Chauhan', studentEmail, studentPasswordHash, '+91 91234 56789');
    }
  } catch (err) {
    console.warn('[Database Notice] Error ensuring demo accounts:', err);
  }
}


function reconcileCanonicalData() {
  try {
    // Reconcile Clean Code canonical ISBN (9780132350884)
    db.prepare(`
      UPDATE books
      SET isbn = '9780132350884'
      WHERE (title LIKE '%Clean Code%' OR title = 'Clean Code')
        AND isbn != '9780132350884'
    `).run();

    // Reconcile Atomic Habits canonical ISBN (9780735211292)
    db.prepare(`
      UPDATE books
      SET isbn = '9780735211292'
      WHERE (title LIKE '%Atomic Habits%' OR title = 'Atomic Habits')
        AND isbn != '9780735211292'
    `).run();

    // Ensure "The Pragmatic Programmer" exists in catalog
    const pragmatic = db.prepare(`
      SELECT id FROM books
      WHERE title LIKE '%Pragmatic Programmer%' OR isbn = '9780135957059'
    `).get();

    if (!pragmatic) {
      let author = db.prepare(`SELECT id FROM authors WHERE name LIKE '%Hunt%' OR name LIKE '%Thomas%'`).get() as any;
      if (!author) {
        const authorRes = db.prepare(`INSERT INTO authors (name, bio) VALUES (?, ?)`).run(
          'Andrew Hunt & David Thomas',
          'Founding authors of The Pragmatic Programmer.'
        );
        author = { id: authorRes.lastInsertRowid };
      }

      let category = db.prepare(`SELECT id FROM categories WHERE slug = 'programming' OR name LIKE '%Programming%'`).get() as any;
      const categoryId = category ? category.id : 2;

      db.prepare(`
        INSERT INTO books (
          title, author_id, category_id, isbn, publisher, publication_year,
          pages, language, description, price, discount, stock, cover_image,
          rating, views, is_archived
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      `).run(
        'The Pragmatic Programmer: 20th Anniversary Edition',
        author.id,
        categoryId,
        '9780135957059',
        'Addison-Wesley Professional',
        2019,
        352,
        'English',
        'One of the most significant books in computer science. Timeless lessons on craftsmanship, career, and system building.',
        899.00,
        12.00,
        25,
        'https://images.unsplash.com/photo-1515879218367-8466d910aaa4?w=600&auto=format&fit=crop&q=80',
        4.92,
        1750
      );
    }
  } catch (err) {
    console.warn('Canonical data reconciliation notice:', err);
  }
}

export const PREDEFINED_CATEGORIES = [
  { name: 'Fiction', slug: 'fiction', icon: 'fa-solid fa-feather-pointed', color: 'text-rose-600', accent_bg: 'bg-rose-50', description: 'Novels, literary masterworks & storytelling' },
  { name: 'Non-Fiction', slug: 'non-fiction', icon: 'fa-solid fa-book-open', color: 'text-amber-600', accent_bg: 'bg-amber-50', description: 'Factual works, journalism & memoirs' },
  { name: 'Science', slug: 'science', icon: 'fa-solid fa-flask', color: 'text-cyan-600', accent_bg: 'bg-cyan-50', description: 'Physics, biology, astronomy & empirical inquiry' },
  { name: 'Technology', slug: 'technology', icon: 'fa-solid fa-microchip', color: 'text-blue-600', accent_bg: 'bg-blue-50', description: 'Innovations, hardware, systems & modern computing' },
  { name: 'Programming', slug: 'programming', icon: 'fa-solid fa-laptop-code', color: 'text-indigo-600', accent_bg: 'bg-indigo-50', description: 'Software engineering, algorithms & web development' },
  { name: 'Cybersecurity', slug: 'cybersecurity', icon: 'fa-solid fa-shield-halved', color: 'text-red-600', accent_bg: 'bg-red-50', description: 'Network security, cryptography & ethical hacking' },
  { name: 'Business', slug: 'business', icon: 'fa-solid fa-briefcase', color: 'text-emerald-600', accent_bg: 'bg-emerald-50', description: 'Enterprise management, strategy & entrepreneurship' },
  { name: 'Finance', slug: 'finance', icon: 'fa-solid fa-chart-line', color: 'text-teal-600', accent_bg: 'bg-teal-50', description: 'Markets, corporate accounting & personal investments' },
  { name: 'History', slug: 'history', icon: 'fa-solid fa-landmark', color: 'text-amber-700', accent_bg: 'bg-amber-100', description: 'World chronicles, civilizations & eras' },
  { name: 'Biography', slug: 'biography', icon: 'fa-solid fa-user-pen', color: 'text-stone-600', accent_bg: 'bg-stone-100', description: 'Memoirs and lives of extraordinary thinkers' },
  { name: 'Self-Help', slug: 'self-help', icon: 'fa-solid fa-brain', color: 'text-violet-600', accent_bg: 'bg-violet-50', description: 'Mindset, productivity & habit formation' },
  { name: 'Psychology', slug: 'psychology', icon: 'fa-solid fa-heart-pulse', color: 'text-pink-600', accent_bg: 'bg-pink-50', description: 'Human cognition, behavior & mental health' },
  { name: 'Philosophy', slug: 'philosophy', icon: 'fa-solid fa-monument', color: 'text-yellow-700', accent_bg: 'bg-yellow-50', description: 'Ethics, epistemology, logic & existential thought' },
  { name: 'Romance', slug: 'romance', icon: 'fa-solid fa-heart', color: 'text-rose-500', accent_bg: 'bg-rose-50', description: 'Passionate tales and romantic fiction' },
  { name: 'Mystery', slug: 'mystery', icon: 'fa-solid fa-magnifying-glass', color: 'text-slate-700', accent_bg: 'bg-slate-100', description: 'Detective stories, puzzles & suspense' },
  { name: 'Thriller', slug: 'thriller', icon: 'fa-solid fa-bolt', color: 'text-orange-600', accent_bg: 'bg-orange-50', description: 'High-stakes suspense & psychological intrigue' },
  { name: 'Fantasy', slug: 'fantasy', icon: 'fa-solid fa-wand-magic-sparkles', color: 'text-purple-600', accent_bg: 'bg-purple-50', description: 'Mythical worlds, magic & epic journeys' },
  { name: 'Education', slug: 'education', icon: 'fa-solid fa-graduation-cap', color: 'text-sky-600', accent_bg: 'bg-sky-50', description: 'Academic textbooks, curricula & pedagogy' },
  { name: 'Science Fiction', slug: 'science-fiction', icon: 'fa-solid fa-rocket', color: 'text-purple-600', accent_bg: 'bg-purple-50', description: 'Cosmic worldbuilding, speculative futures & space sagas' },
  { name: 'Other', slug: 'other', icon: 'fa-solid fa-shapes', color: 'text-slate-500', accent_bg: 'bg-slate-50', description: 'General collection and eclectic volumes' }
];

function ensurePredefinedCategories() {
  const insertCat = db.prepare(`
    INSERT OR IGNORE INTO categories (name, slug, icon, color, accent_bg, description)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const cat of PREDEFINED_CATEGORIES) {
    insertCat.run(cat.name, cat.slug, cat.icon, cat.color, cat.accent_bg, cat.description);
  }
}

export function ensureExpandedCatalogueSeed() {
  try {
    const booksCount = (db.prepare('SELECT COUNT(*) as count FROM books').get() as any)?.count || 0;
    if (booksCount >= 300) {
      return;
    }

    const seedPath = path.resolve(process.cwd(), 'data', 'catalogue-seed-data.json');
    if (!fs.existsSync(seedPath)) {
      return;
    }

    const rawCandidates = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
    if (!Array.isArray(rawCandidates) || rawCandidates.length === 0) {
      return;
    }

    // Categories lookup maps
    const categories = db.prepare('SELECT id, name, slug FROM categories').all() as any[];
    const categoryBySlug = new Map<string, any>();
    const categoryByName = new Map<string, any>();
    for (const cat of categories) {
      if (cat.slug) categoryBySlug.set(cat.slug.toLowerCase().trim(), cat);
      if (cat.name) categoryByName.set(cat.name.toLowerCase().trim(), cat);
    }

    // Existing books index for deduplication
    const existingBooks = db.prepare(`
      SELECT b.isbn, b.title, a.name as author_name
      FROM books b
      LEFT JOIN authors a ON b.author_id = a.id
    `).all() as any[];

    const existingIsbns = new Set<string>();
    const existingTitles = new Set<string>();

    function normalizeIsbn(val: any): string {
      return String(val || '').replace(/[^0-9X]/gi, '').toUpperCase();
    }

    function normalizeTitleAuthor(title: any, author: any): string {
      const cleanTitle = String(title || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
      const cleanAuthor = String(author || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
      return `${cleanTitle}::${cleanAuthor}`;
    }

    for (const b of existingBooks) {
      if (b.isbn) existingIsbns.add(normalizeIsbn(b.isbn));
      existingTitles.add(normalizeTitleAuthor(b.title, b.author_name));
    }

    const insertAuthor = db.prepare('INSERT INTO authors (name, bio) VALUES (?, ?)');
    const findAuthor = db.prepare('SELECT id FROM authors WHERE name = ?');
    const insertBook = db.prepare(`
      INSERT INTO books (
        title, author_id, category_id, isbn, publisher, publication_year,
        pages, language, description, price, discount, stock, cover_image,
        rating, views, is_archived
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `);

    const importTransaction = db.transaction(() => {
      let imported = 0;
      for (const candidate of rawCandidates) {
        if (!candidate.title || !candidate.author || !candidate.isbn) {
          continue;
        }

        const cleanIsbn = normalizeIsbn(candidate.isbn);
        if (cleanIsbn.length !== 10 && cleanIsbn.length !== 13) {
          continue;
        }

        const titleKey = normalizeTitleAuthor(candidate.title, candidate.author);
        if (existingIsbns.has(cleanIsbn) || existingTitles.has(titleKey)) {
          continue;
        }

        const slug = String(candidate.categorySlug || '').toLowerCase().trim();
        const name = String(candidate.category || '').toLowerCase().trim();
        const matchedCat = categoryBySlug.get(slug) || categoryByName.get(name) || categoryByName.get(slug) || categoryBySlug.get('other') || { id: 1 };

        let author = findAuthor.get(candidate.author.trim()) as any;
        let authorId: number;
        if (author) {
          authorId = author.id;
        } else {
          const res = insertAuthor.run(candidate.author.trim(), `Author of ${candidate.title}.`);
          authorId = Number(res.lastInsertRowid);
        }

        const price = typeof candidate.price === 'number' && candidate.price > 0 ? candidate.price : 499.0;
        const discount = typeof candidate.discount === 'number' && candidate.discount >= 0 ? candidate.discount : 10.0;
        const stock = typeof candidate.stock === 'number' && candidate.stock >= 0 ? candidate.stock : 20;
        const rating = typeof candidate.rating === 'number' && candidate.rating >= 1 && candidate.rating <= 5 ? candidate.rating : 4.8;
        const pubYear = candidate.publicationYear ? parseInt(String(candidate.publicationYear), 10) : null;
        const pages = candidate.pages ? parseInt(String(candidate.pages), 10) : null;

        insertBook.run(
          candidate.title.trim(),
          authorId,
          matchedCat.id,
          cleanIsbn,
          candidate.publisher ? candidate.publisher.trim() : null,
          pubYear,
          pages,
          candidate.language || 'English',
          candidate.description ? candidate.description.trim() : null,
          price,
          discount,
          stock,
          candidate.coverImage || null,
          rating,
          Math.floor(Math.random() * 400) + 100
        );

        existingIsbns.add(cleanIsbn);
        existingTitles.add(titleKey);
        imported++;
      }
      return imported;
    });

    const count = importTransaction();
    if (count > 0) {
      console.log(`📚 [Catalogue Expansion] Successfully imported ${count} books from catalogue-seed-data.json across all categories.`);
    }
  } catch (err: any) {
    console.warn('[Catalogue Expansion Error]:', err.message);
  }
}

function seedData() {
  const usersCount = (db.prepare('SELECT COUNT(*) as count FROM users').get() as any).count;
  if (usersCount > 0) {
    return; // Already seeded
  }

  console.log('🌱 Seeding database with initial users, authors, categories, and 32 books...');

  // 1. Seed Users (Securely hashed with bcrypt)
  const studentPasswordHash = bcrypt.hashSync('User@123', 10);
  const adminPasswordHash = bcrypt.hashSync('Admin@123', 10);

  const insertUser = db.prepare(`
    INSERT INTO users (id, name, email, password_hash, role, phone, joined_date)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  insertUser.run(1, 'BookNest Administrator', 'admin@booknest.com', adminPasswordHash, 'admin', '+91 98765 43210', 'August 2024');
  insertUser.run(2, 'Aditya Chauhan', 'user@booknest.com', studentPasswordHash, 'user', '+91 91234 56789', 'August 2024');

  // Seed default address for user 2
  db.prepare(`
    INSERT INTO addresses (user_id, full_name, phone, hostel_block, room_no, is_default)
    VALUES (?, ?, ?, ?, ?, 1)
  `).run(2, 'Aditya Chauhan', '+91 98765 43210', 'Aryabhata Academic Hall (Block C)', 'Room 314');

  // 2. Seed Categories
  const insertCat = db.prepare(`
    INSERT OR REPLACE INTO categories (id, name, slug, description, icon, color, accent_bg)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  insertCat.run(1, 'Fiction & Literature', 'fiction', 'Timeless classics, evocative prose & modern narrative masterworks', 'fa-solid fa-feather-pointed', 'text-rose-600', 'bg-rose-50');
  insertCat.run(2, 'Computer Science & Tech', 'programming', 'Engineering craftsmanship, system design & security', 'fa-solid fa-laptop-code', 'text-indigo-600', 'bg-indigo-50');
  insertCat.run(3, 'Science Fiction', 'science-fiction', 'Cosmic worldbuilding, speculative futures & space sagas', 'fa-solid fa-rocket', 'text-purple-600', 'bg-purple-50');
  insertCat.run(4, 'Business & Economics', 'business', 'Behavioral finance, market psychology & executive leadership', 'fa-solid fa-chart-line', 'text-emerald-600', 'bg-emerald-50');
  insertCat.run(5, 'Self Help & Mindset', 'self-help', 'Habit mastery, cognitive resilience & continuous self-growth', 'fa-solid fa-brain', 'text-amber-600', 'bg-amber-50');
  insertCat.run(6, 'Cybersecurity', 'cybersecurity', 'Defensive security, cryptography, and digital privacy', 'fa-solid fa-shield-halved', 'text-cyan-600', 'bg-cyan-50');
  insertCat.run(7, 'History & Biography', 'history', 'Memoirs and captivating true-life journeys of innovators', 'fa-solid fa-landmark', 'text-orange-600', 'bg-orange-50');

  // 3. Seed Authors
  const insertAuthor = db.prepare('INSERT INTO authors (id, name, bio) VALUES (?, ?, ?)');
  insertAuthor.run(1, 'James Clear', 'Author of the #1 New York Times bestseller Atomic Habits.');
  insertAuthor.run(2, 'Robert C. Martin', 'Uncle Bob, celebrated software craftsman and author of Clean Code.');
  insertAuthor.run(3, 'F. Scott Fitzgerald', 'Iconic novelist celebrated for The Great Gatsby.');
  insertAuthor.run(4, 'Frank Herbert', 'American science fiction author best known for Dune.');
  insertAuthor.run(5, 'George Orwell', 'English novelist and critic famous for 1984 and Animal Farm.');
  insertAuthor.run(6, 'Morgan Housel', 'Author of The Psychology of Money and Same as Ever.');
  insertAuthor.run(7, 'Kevin D. Mitnick', 'World renowned cybersecurity expert and author of The Art of Invisibility.');
  insertAuthor.run(8, 'Daniel Kahneman', 'Nobel laureate in economics, author of Thinking, Fast and Slow.');
  insertAuthor.run(9, 'Peter Thiel', 'Entrepreneur and venture capitalist, author of Zero to One.');
  insertAuthor.run(10, 'Martin Kleppmann', 'Researcher in distributed systems and author of Designing Data-Intensive Applications.');
  insertAuthor.run(11, 'Andrew Hunt & David Thomas', 'Founding authors of The Pragmatic Programmer.');
  insertAuthor.run(12, 'Erich Gamma et al.', 'Gang of Four authors of Design Patterns.');
  insertAuthor.run(13, 'Harper Lee', 'Pulitzer Prize-winning author of To Kill a Mockingbird.');
  insertAuthor.run(14, 'Isaac Asimov', 'Legendary science fiction author of Foundation.');
  insertAuthor.run(15, 'Cal Newport', 'Georgetown CS Professor, author of Deep Work and Digital Minimalism.');
  insertAuthor.run(16, 'Walter Isaacson', 'Author of Steve Jobs and Elon Musk.');

  // 4. Seed 32 Books
  const insertBook = db.prepare(`
    INSERT INTO books (id, title, author_id, category_id, isbn, publisher, publication_year, pages, language, description, price, discount, stock, cover_image, rating, views)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertBook.run(1, 'Atomic Habits', 1, 5, '9780735211292', 'Avery / Penguin Random House', 2018, 320, 'English', 'An easy and proven way to build good habits and break bad ones. Practical strategies for continuous self-improvement.', 499.00, 15.00, 45, 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=600&auto=format&fit=crop&q=80', 4.90, 1850);
  insertBook.run(2, 'Clean Code: A Handbook of Agile Software Craftsmanship', 2, 2, '9780132350884', 'Prentice Hall', 2008, 464, 'English', 'Even bad code can function. But if code isn\'t clean, it can bring a development organization to its knees. Master professional craftsmanship.', 799.00, 10.00, 28, 'https://images.unsplash.com/photo-1532012164546-f432f2e3777a?w=600&auto=format&fit=crop&q=80', 4.85, 1420);
  insertBook.run(3, 'The Great Gatsby', 3, 1, '9780743273565', 'Scribner', 1925, 180, 'English', 'The quintessential Jazz Age novel capturing Jay Gatsby\'s tragic pursuit of Daisy Buchanan amidst luxury, obsession, and American disillusionment.', 299.00, 0.00, 60, 'https://images.unsplash.com/photo-1512820790803-83ca734da794?w=600&auto=format&fit=crop&q=80', 4.70, 980);
  insertBook.run(4, 'Dune: The Graphic & Epic Chronicle', 4, 3, '9780441013593', 'Ace Books', 1965, 688, 'English', 'Set on the desert planet Arrakis, Dune is the story of Paul Atreides, heir to a noble family in a galactic empire controlled by the priceless spice melange.', 599.00, 20.00, 35, 'https://images.unsplash.com/photo-1506466010722-395aa2bef877?w=600&auto=format&fit=crop&q=80', 4.88, 2300);
  insertBook.run(5, '1984: Definitive Edition', 5, 1, '9780451524935', 'Signet Classic', 1949, 328, 'English', 'Winston Smith toes the Party line, rewriting history to satisfy the Ministry of Truth until rebellion stirs within his thoughts under Big Brother\'s gaze.', 349.00, 12.00, 50, 'https://images.unsplash.com/photo-1495640388908-05fa85288e61?w=600&auto=format&fit=crop&q=80', 4.82, 1600);
  insertBook.run(6, 'The Psychology of Money', 6, 4, '9780857197689', 'Harriman House', 2020, 256, 'English', 'Timeless lessons on wealth, greed, and happiness. Doing well with money isn\'t necessarily about what you know. It\'s about how you behave.', 449.00, 10.00, 75, 'https://images.unsplash.com/photo-1553729459-efe14ef6055d?w=600&auto=format&fit=crop&q=80', 4.80, 2100);
  insertBook.run(7, 'Design Patterns: Elements of Reusable Object-Oriented Software', 12, 2, '9780201633610', 'Addison-Wesley Professional', 1994, 416, 'English', 'Four top-notch designers present a catalog of simple and succinct solutions to commonly occurring design problems.', 899.00, 15.00, 14, 'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=600&auto=format&fit=crop&q=80', 4.90, 1950);
  insertBook.run(8, 'The Art of Invisibility', 7, 6, '9780316380508', 'Little, Brown and Company', 2017, 320, 'English', 'The world\'s most famous hacker teaches you how to be safe in the age of big data and surveillance. Master digital privacy.', 649.00, 5.00, 5, 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=600&auto=format&fit=crop&q=80', 4.65, 890);
  insertBook.run(9, 'Thinking, Fast and Slow', 8, 5, '9780374533557', 'Farrar, Straus and Giroux', 2011, 499, 'English', 'Nobel laureate Daniel Kahneman explores the two systems that drive our thinking: System 1 (fast/intuitive) and System 2 (slow/logical).', 520.00, 10.00, 32, 'https://images.unsplash.com/photo-1457369804613-52c61a468e7d?w=600&auto=format&fit=crop&q=80', 4.78, 1780);
  insertBook.run(10, 'Foundation', 14, 3, '9780553293357', 'Spectra / Bantam Books', 1951, 255, 'English', 'Hari Seldon uses mathematical psychohistory to predict the fall of the Galactic Empire and establishes the Foundation.', 420.00, 8.00, 3, 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=600&auto=format&fit=crop&q=80', 4.81, 1420);
  insertBook.run(11, 'To Kill a Mockingbird', 13, 1, '9780060935467', 'Harper Perennial Modern Classics', 1960, 336, 'English', 'Harper Lee\'s Pulitzer Prize-winning masterpiece exploring racial injustice and morality in the American South.', 380.00, 0.00, 42, 'https://images.unsplash.com/photo-1476275466078-4007374efbbe?w=600&auto=format&fit=crop&q=80', 4.92, 1600);
  insertBook.run(12, 'Zero to One: Notes on Startups', 9, 4, '9780804139298', 'Crown Business', 2014, 224, 'English', 'How to build companies that create new things from zero to one. Master the art of visionary business building.', 499.00, 14.00, 24, 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=600&auto=format&fit=crop&q=80', 4.74, 1510);
  insertBook.run(13, 'Designing Data-Intensive Applications', 10, 2, '9781449373320', 'O\'Reilly Media', 2017, 616, 'English', 'The definitive guide to principles and practices of data processing architectures, replication, partitioning, and consistency.', 1199.00, 10.00, 18, 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=600&auto=format&fit=crop&q=80', 4.95, 2300);
  insertBook.run(14, 'The Pragmatic Programmer: 20th Anniversary Edition', 11, 2, '9780135957059', 'Addison-Wesley Professional', 2019, 352, 'English', 'One of the most significant books in computer science. Timeless lessons on craftsmanship, career, and system building.', 899.00, 12.00, 25, 'https://images.unsplash.com/photo-1515879218367-8466d910aaa4?w=600&auto=format&fit=crop&q=80', 4.92, 1750);
  insertBook.run(15, 'Deep Work: Rules for Focused Success', 15, 5, '9781455586691', 'Grand Central Publishing', 2016, 304, 'English', 'The ability to focus without distraction on a cognitively demanding task is a superpower in our distracted knowledge economy.', 499.00, 12.00, 30, 'https://images.unsplash.com/photo-1457369804613-52c61a468e7d?w=600&auto=format&fit=crop&q=80', 4.81, 1340);
  insertBook.run(16, 'Clean Architecture: A Craftsman\'s Guide to Software Structure', 2, 2, '9780134494166', 'Prentice Hall', 2017, 432, 'English', 'Universal rules of software structure and boundaries from Uncle Bob that dramatically boost component independence.', 850.00, 15.00, 22, 'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=600&auto=format&fit=crop&q=80', 4.82, 1140);
  insertBook.run(17, 'Steve Jobs', 16, 7, '9781451648539', 'Simon & Schuster', 2011, 656, 'English', 'Walter Isaacson\'s bestselling biography based on more than forty interviews with Steve Jobs conducted over two years.', 699.00, 20.00, 25, 'https://images.unsplash.com/photo-1505373877841-8d25f7d46678?w=600&auto=format&fit=crop&q=80', 4.79, 1420);
  insertBook.run(18, 'Digital Minimalism: Choosing a Focused Life', 15, 5, '9780525536512', 'Portfolio', 2019, 304, 'English', 'Cal Newport outlines practical steps to declutter digital distractions and reclaim hours for focused study.', 480.00, 10.00, 32, 'https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=600&auto=format&fit=crop&q=80', 4.70, 930);

  // 5. Seed Coupons
  const insertCoupon = db.prepare('INSERT INTO coupons (code, discount_type, discount_value, min_order_amount) VALUES (?, ?, ?, ?)');
  insertCoupon.run('WELCOME10', 'percent', 10, 0);
  insertCoupon.run('BOOKNEST50', 'fixed', 50, 499);
  insertCoupon.run('READMORE', 'percent', 15, 699);

  // 6. Seed Cart for student (User 2)
  const insertCart = db.prepare('INSERT INTO cart_items (user_id, book_id, quantity) VALUES (?, ?, ?)');
  insertCart.run(2, 1, 1);
  insertCart.run(2, 2, 1);

  // 7. Seed Wishlist for student (User 2)
  const insertWishlist = db.prepare('INSERT INTO wishlist (user_id, book_id) VALUES (?, ?)');
  insertWishlist.run(2, 4);
  insertWishlist.run(2, 6);

  // 8. Seed Initial Order with items
  const insertOrder = db.prepare(`
    INSERT INTO orders (id, user_id, order_number, status, payment_method, payment_status, subtotal, discount_amount, delivery_fee, gst_amount, grand_total, full_name, phone, hostel_block, room_no, delivery_notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertOrder.run(
    104821,
    2,
    'BN-2026-104821',
    'Confirmed',
    'UPI',
    'DEMO PAID',
    1148.00,
    0.00,
    0.00,
    57.00,
    1148.00,
    'Aditya Chauhan',
    '+91 98765 43210',
    'Aryabhata Academic Hall (Block C)',
    'Room 314',
    'Please leave at hostel reception or ring buzzer',
    '2026-09-24 16:30:00'
  );

  const insertOrderItem = db.prepare('INSERT INTO order_items (order_id, book_id, quantity, unit_price, line_total) VALUES (?, ?, ?, ?, ?)');
  insertOrderItem.run(104821, 1, 1, 424.00, 424.00);
  insertOrderItem.run(104821, 2, 1, 719.00, 719.00);

  // 9. Seed Sample Reviews
  const insertReview = db.prepare(`
    INSERT INTO reviews (book_id, user_id, rating, title, comment, is_verified, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  insertReview.run(1, 2, 5, 'Transformed my study habits!', 'Atomic Habits gave me actionable 1% daily increments that revolutionized my semester.', 1, '2026-09-20 10:00:00');
  insertReview.run(2, 2, 5, 'Every developer must read this', 'Clean Code taught me how to write code that my peers and future self can actually maintain.', 1, '2026-09-22 14:30:00');
  insertReview.run(6, 2, 5, 'Masterpiece on investor psychology', 'Doing well with money is about behavior, not math. Outstanding read for students.', 1, '2026-09-23 09:15:00');

  console.log('✅ Database seeded successfully with persistent records.');
}

export function closeDatabase() {
  if (db && db.open) {
    db.close();
  }
}
