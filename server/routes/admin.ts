import { Router } from 'express';
import { db } from '../db/database.js';
import { requireAdmin, AuthRequest } from '../middleware/auth.js';
import { booksController } from '../controllers/booksController.js';
import { ordersController } from '../controllers/ordersController.js';

const router = Router();

// Apply admin privilege check to all admin routes
router.use(requireAdmin);

// Dashboard metrics computed from real database records
router.get('/metrics', (req, res) => {
  const totalRevenue = (db.prepare('SELECT COALESCE(SUM(grand_total), 0) as total FROM orders').get() as any).total;
  const totalOrders = (db.prepare('SELECT COUNT(*) as count FROM orders').get() as any).count;
  const totalBooks = (db.prepare('SELECT COUNT(*) as count FROM books').get() as any).count;
  const totalStockUnits = (db.prepare('SELECT COALESCE(SUM(stock), 0) as total FROM books').get() as any).total;
  const lowStockCount = (db.prepare('SELECT COUNT(*) as count FROM books WHERE stock <= 10').get() as any).count;

  // Real breakdown of orders by status from SQLite
  const ordersByStatus = db.prepare(`
    SELECT status, COUNT(*) as count, COALESCE(SUM(grand_total), 0) as total
    FROM orders
    GROUP BY status
  `).all() as any[];

  // Real recent daily sales volume from SQLite
  const recentSales = db.prepare(`
    SELECT 
      DATE(created_at) as date,
      COUNT(*) as ordersCount,
      COALESCE(SUM(grand_total), 0) as dailyTotal
    FROM orders
    GROUP BY DATE(created_at)
    ORDER BY date DESC
    LIMIT 7
  `).all() as any[];

  // Real category inventory distribution
  const categoryBreakdown = db.prepare(`
    SELECT c.name as category, COUNT(b.id) as bookCount, COALESCE(SUM(b.stock), 0) as stockCount
    FROM categories c
    LEFT JOIN books b ON b.category_id = c.id
    GROUP BY c.id, c.name
    ORDER BY bookCount DESC
  `).all() as any[];

  res.json({
    metrics: {
      totalRevenue,
      totalOrders,
      totalBooks,
      totalStockUnits,
      lowStockCount,
      ordersByStatus,
      recentSales,
      categoryBreakdown
    }
  });
});

// Get all orders across the campus
router.get('/orders', ordersController.getAdminOrders);

router.patch('/orders/:id/status', ordersController.updateOrderStatus);
router.put('/orders/:id/status', ordersController.updateOrderStatus);

// Add new book to catalog
router.post('/books', (req, res) => {
  const {
    title,
    author,
    category,
    price,
    discount = 0,
    stock = 10,
    isbn,
    publisher = 'Campus Academic Press',
    pages = 300,
    year = 2024,
    language = 'English',
    description = '',
    coverImage = 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=600&auto=format&fit=crop&q=80'
  } = req.body;

  return booksController.createBook(req, res);
});

// Update book details
router.put('/books/:id', booksController.updateBook);

// Update stock level
router.patch('/books/:id/stock', booksController.updateStock);

// Delete book
router.delete('/books/:id', booksController.deleteBook);

export default router;
