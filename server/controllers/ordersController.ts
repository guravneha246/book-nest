import crypto from 'crypto';
import { Response } from 'express';
import { db } from '../database/index.js';
import { AuthRequest } from '../middleware/auth.js';

function ensureIdempotencyTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS idempotency_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      response_status INTEGER NOT NULL,
      response_body TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, key)
    );
    CREATE INDEX IF NOT EXISTS idx_idempotency_user_key ON idempotency_keys(user_id, key);
  `);
}

export function formatOrderDate(dateVal: string | Date | null | undefined): string {
  if (!dateVal) return '';
  let d: Date;
  if (typeof dateVal === 'string') {
    let normalized = dateVal.trim();
    if (!normalized.includes('T') && normalized.includes(' ')) {
      normalized = normalized.replace(' ', 'T') + 'Z';
    } else if (normalized.includes('T') && !normalized.endsWith('Z') && !normalized.includes('+')) {
      normalized = normalized + 'Z';
    }
    d = new Date(normalized);
  } else {
    d = dateVal;
  }
  if (isNaN(d.getTime())) return String(dateVal);

  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
}

export const ordersController = {
  // GET /api/orders
  getOrders: (req: AuthRequest, res: Response) => {
    const userId = req.user?.id;

    const orders = db.prepare(`
      SELECT 
        o.id,
        o.order_number as orderNumber,
        o.status,
        o.payment_method as paymentMethod,
        o.payment_status as paymentStatus,
        o.subtotal,
        o.discount_amount as discountAmount,
        o.delivery_fee as deliveryFee,
        o.gst_amount as gstAmount,
        o.grand_total as total,
        o.full_name as fullName,
        o.phone,
        o.hostel_block as hostelBlock,
        o.room_no as roomNo,
        o.delivery_notes as deliveryNotes,
        o.paid_at as paidAt,
        o.cancelled_at as cancelledAt,
        o.created_at as createdAt
      FROM orders o
      WHERE o.user_id = ?
      ORDER BY o.created_at DESC
    `).all(userId) as any[];

    const getItemStmt = db.prepare(`
      SELECT 
        oi.quantity,
        oi.unit_price as price,
        b.id,
        b.title,
        a.name as author,
        c.name as category,
        b.cover_image as coverImage,
        b.isbn
      FROM order_items oi
      LEFT JOIN books b ON oi.book_id = b.id
      LEFT JOIN authors a ON b.author_id = a.id
      LEFT JOIN categories c ON b.category_id = c.id
      WHERE oi.order_id = ?
    `);

    const enrichedOrders = orders.map(order => {
      const rawItems = getItemStmt.all(order.id) as any[];
      return {
        id: order.id,
        orderNumber: order.orderNumber,
        date: formatOrderDate(order.paidAt || order.createdAt),
        paidAt: order.paidAt || null,
        createdAt: order.createdAt,
        cancelledAt: order.cancelledAt || null,
        total: order.total,
        status: order.status,
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
        address: {
          name: order.fullName,
          phone: order.phone,
          address: `${order.roomNo}, ${order.hostelBlock}`,
          hostelBlock: order.hostelBlock,
          roomNo: order.roomNo,
          notes: order.deliveryNotes
        },
        items: rawItems.map(i => ({
          book: {
            id: i.id,
            title: i.title,
            author: i.author,
            category: i.category,
            coverImage: i.coverImage,
            isbn: i.isbn
          },
          quantity: i.quantity,
          price: i.price
        }))
      };
    });

    res.json({ orders: enrichedOrders });
  },

  // GET /api/orders/:id
  getOrderById: (req: AuthRequest, res: Response) => {
    const userId = req.user?.id;
    const { id } = req.params;
    const isAdmin = req.user?.role === 'admin';

    const orderQuery = isAdmin
      ? 'SELECT * FROM orders WHERE id = ? OR order_number = ?'
      : 'SELECT * FROM orders WHERE (id = ? OR order_number = ?) AND user_id = ?';

    const params = isAdmin ? [id, id] : [id, id, userId];
    const order = db.prepare(orderQuery).get(...params) as any;

    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    const items = db.prepare(`
      SELECT 
        oi.quantity,
        oi.unit_price as price,
        oi.line_total as lineTotal,
        b.id,
        b.title,
        a.name as author,
        c.name as category,
        b.cover_image as coverImage,
        b.isbn
      FROM order_items oi
      LEFT JOIN books b ON oi.book_id = b.id
      LEFT JOIN authors a ON b.author_id = a.id
      LEFT JOIN categories c ON b.category_id = c.id
      WHERE oi.order_id = ?
    `).all(order.id) as any[];

    res.json({
      order: {
        id: order.id,
        orderNumber: order.order_number,
        date: formatOrderDate(order.paid_at || order.created_at),
        paidAt: order.paid_at || null,
        createdAt: order.created_at,
        cancelledAt: order.cancelled_at || null,
        status: order.status,
        paymentMethod: order.payment_method,
        paymentStatus: order.payment_status,
        subtotal: order.subtotal,
        discountAmount: order.discount_amount,
        deliveryFee: order.delivery_fee,
        gstAmount: order.gst_amount,
        grandTotal: order.grand_total,
        address: {
          name: order.full_name,
          phone: order.phone,
          address: `${order.room_no}, ${order.hostel_block}`,
          hostelBlock: order.hostel_block,
          roomNo: order.room_no,
          notes: order.delivery_notes
        },
        items: items.map(i => ({
          book: {
            id: i.id,
            title: i.title,
            author: i.author,
            category: i.category,
            coverImage: i.coverImage,
            isbn: i.isbn
          },
          quantity: i.quantity,
          unitPrice: i.price,
          lineTotal: i.lineTotal
        }))
      }
    });
  },

  // POST /api/orders
  createOrder: (req: AuthRequest, res: Response) => {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required to place an order.' });
    }

    const {
      address,
      paymentMethod = 'UPI',
      items,
      couponCode: explicitCouponCode,
      summary
    } = req.body;

    // 1. Validate delivery address
    if (!address || !address.fullName || !address.hostelBlock || !address.roomNo || !address.phone) {
      return res.status(400).json({ error: 'Complete campus delivery address is required.' });
    }

    // 2. Validate items array
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Order must contain at least one book.' });
    }

    // 3. Pre-validate individual item structures & consolidate quantities by bookId
    const consolidatedItemsMap = new Map<number, number>();
    for (const item of items) {
      const bookId = Number(item.bookId || item.book?.id);
      const qty = Number(item.quantity);
      if (!bookId || isNaN(bookId) || bookId <= 0 || !Number.isInteger(qty) || qty <= 0) {
        return res.status(400).json({ error: 'Invalid book ID or quantity in order payload.' });
      }
      if (qty > 99) {
        return res.status(400).json({ error: 'Maximum quantity per book is 99 units.' });
      }
      consolidatedItemsMap.set(bookId, (consolidatedItemsMap.get(bookId) || 0) + qty);
    }

    for (const [bookId, totalQty] of consolidatedItemsMap.entries()) {
      if (totalQty > 99) {
        return res.status(400).json({ error: `Total requested quantity for book ID ${bookId} exceeds maximum allowed limit of 99 units.` });
      }
    }

    // 4. Server-Side Idempotency-Key Check
    const rawIdempotencyKey = (req.headers['idempotency-key'] || req.headers['x-idempotency-key']) as string | undefined;
    let cleanIdempotencyKey: string | null = null;
    let requestPayloadHash: string | null = null;

    if (rawIdempotencyKey !== undefined) {
      if (typeof rawIdempotencyKey !== 'string' || !rawIdempotencyKey.trim()) {
        return res.status(400).json({ error: 'Idempotency-Key header must be a non-empty string.' });
      }
      cleanIdempotencyKey = rawIdempotencyKey.trim();
      if (cleanIdempotencyKey.length > 255) {
        return res.status(400).json({ error: 'Idempotency-Key header exceeds maximum length of 255 characters.' });
      }

      ensureIdempotencyTable();

      const normalizedItems = Array.from(consolidatedItemsMap.entries())
        .map(([bookId, quantity]) => ({ bookId, quantity }))
        .sort((a, b) => a.bookId - b.bookId);

      requestPayloadHash = crypto
        .createHash('sha256')
        .update(JSON.stringify({
          userId,
          address: {
            fullName: String(address.fullName).trim(),
            phone: String(address.phone).trim(),
            hostelBlock: String(address.hostelBlock).trim(),
            roomNo: String(address.roomNo).trim()
          },
          items: normalizedItems,
          couponCode: (explicitCouponCode || summary?.couponCode || '').trim().toUpperCase(),
          paymentMethod: String(paymentMethod).toUpperCase()
        }))
        .digest('hex');

      const existingRecord = db.prepare(`
        SELECT response_status, response_body, request_hash
        FROM idempotency_keys
        WHERE user_id = ? AND key = ?
      `).get(userId, cleanIdempotencyKey) as any;

      if (existingRecord) {
        if (existingRecord.request_hash === requestPayloadHash) {
          res.setHeader('Idempotent-Replayed', 'true');
          const cachedJson = JSON.parse(existingRecord.response_body);
          return res.status(existingRecord.response_status).json(cachedJson);
        } else {
          return res.status(409).json({
            error: 'Idempotency conflict: A previous request was processed with this Idempotency-Key but with a different payload.'
          });
        }
      }
    }

    const orderNumber = `BN-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;

    try {
      // Execute atomic transaction with immediate write lock:
      // Stock verification -> authoritative pricing -> row-level stock decrement -> order insertion -> cart cleanup
      const orderTxResult = db.transaction(() => {
        const lineItemsToInsert: Array<{
          bookId: number;
          quantity: number;
          unitPrice: number;
          lineTotal: number;
        }> = [];

        // 1. Authoritative price and stock check for every item
        for (const [bookId, qty] of consolidatedItemsMap.entries()) {
          const book = db.prepare(`
            SELECT id, title, stock, price, discount, is_archived
            FROM books
            WHERE id = ?
          `).get(bookId) as any;

          if (!book) {
            throw new Error(`Book ID ${bookId} does not exist in catalog.`);
          }

          if (book.is_archived === 1) {
            throw new Error(`"${book.title}" is archived and no longer available for purchase.`);
          }

          if (book.stock < qty) {
            throw new Error(`Insufficient stock for "${book.title}". Available: ${book.stock}, Requested: ${qty}`);
          }

          // Authoritative server-side price calculation
          const unitPrice = Math.round(book.price * (1.0 - (book.discount || 0.0) / 100.0));
          const lineTotal = unitPrice * qty;

          lineItemsToInsert.push({
            bookId,
            quantity: qty,
            unitPrice,
            lineTotal
          });
        }

        // 2. Server-side subtotal calculation
        const serverSubtotal = lineItemsToInsert.reduce((sum, item) => sum + item.lineTotal, 0);

        // 3. Server-side coupon recalculation & verification
        const candidateCouponCode = (explicitCouponCode || summary?.couponCode || '').trim().toUpperCase();
        let serverCouponDiscount = 0;
        let appliedCouponCode: string | null = null;

        if (candidateCouponCode) {
          const coupon = db.prepare('SELECT * FROM coupons WHERE UPPER(code) = ? AND is_active = 1').get(candidateCouponCode) as any;
          if (!coupon) {
            throw new Error(`Invalid or expired coupon code "${candidateCouponCode}".`);
          }

          if (serverSubtotal < coupon.min_order_amount) {
            throw new Error(`Coupon "${coupon.code}" requires a minimum cart subtotal of ₹${coupon.min_order_amount}. Current subtotal: ₹${serverSubtotal}.`);
          }

          if (coupon.discount_type === 'percent') {
            serverCouponDiscount = Math.round(serverSubtotal * (coupon.discount_value / 100));
          } else {
            serverCouponDiscount = Math.min(serverSubtotal, coupon.discount_value);
          }
          appliedCouponCode = coupon.code;
        }

        // 4. Server-side delivery fee calculation (Free delivery threshold = ₹499)
        const freeDeliveryThreshold = 499;
        const serverDeliveryFee = (serverSubtotal >= freeDeliveryThreshold || serverSubtotal === 0) ? 0 : 49;

        // 5. Server-side GST (5% academic book GST)
        const serverGstAmount = Math.round(serverSubtotal * 0.05);

        // 6. Server-side authoritative Grand Total
        const serverGrandTotal = Math.max(0, serverSubtotal - serverCouponDiscount + serverDeliveryFee);

        // 7. Decrement stock for purchased books with row-level oversell guard
        for (const lineItem of lineItemsToInsert) {
          const updateResult = db.prepare(`
            UPDATE books
            SET stock = stock - ?
            WHERE id = ? AND stock >= ?
          `).run(lineItem.quantity, lineItem.bookId, lineItem.quantity);

          if (updateResult.changes === 0) {
            throw new Error(`Insufficient stock for book ID ${lineItem.bookId}. Stock was claimed by a concurrent checkout.`);
          }
        }

        // Authoritative server timestamp & payment status calculation
        const nowUtc = new Date().toISOString();
        const methodUpper = String(paymentMethod).toUpperCase();
        const isDemoPaid = methodUpper === 'UPI' || methodUpper === 'CARD';
        const paymentStatus = isDemoPaid ? 'DEMO PAID' : 'PENDING (COD)';
        const paidAt = isDemoPaid ? nowUtc : null;

        // 8. Insert order record with server clock timestamps
        const orderInsertResult = db.prepare(`
          INSERT INTO orders (
            user_id, order_number, status, payment_method, payment_status,
            subtotal, discount_amount, delivery_fee, gst_amount, grand_total,
            full_name, phone, hostel_block, room_no, delivery_notes,
            paid_at, created_at
          ) VALUES (?, ?, 'Confirmed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          userId,
          orderNumber,
          methodUpper,
          paymentStatus,
          serverSubtotal,
          serverCouponDiscount,
          serverDeliveryFee,
          serverGstAmount,
          serverGrandTotal,
          address.fullName,
          address.phone,
          address.hostelBlock,
          address.roomNo,
          address.deliveryNotes || '',
          paidAt,
          nowUtc
        );

        const newOrderId = Number(orderInsertResult.lastInsertRowid);

        // Record demo payment ledger entry
        try {
          const demoTxnId = `DEMO_TXN_${orderNumber}_${Date.now()}`;
          db.prepare(`
            INSERT INTO payments (
              order_id, amount, currency, method, status, transaction_id, paid_at, created_at
            ) VALUES (?, ?, 'INR', ?, ?, ?, ?, ?)
          `).run(
            newOrderId,
            serverGrandTotal,
            methodUpper,
            paymentStatus,
            demoTxnId,
            paidAt,
            nowUtc
          );
        } catch (payErr) {
          console.warn('Non-critical payments ledger insert warning:', payErr);
        }

        // 9. Insert order items
        const insertItemStmt = db.prepare(`
          INSERT INTO order_items (order_id, book_id, quantity, unit_price, line_total)
          VALUES (?, ?, ?, ?, ?)
        `);

        for (const lineItem of lineItemsToInsert) {
          insertItemStmt.run(newOrderId, lineItem.bookId, lineItem.quantity, lineItem.unitPrice, lineItem.lineTotal);
        }

        // 10. Update user default delivery address
        db.prepare(`
          INSERT INTO addresses (user_id, full_name, phone, hostel_block, room_no, is_default)
          VALUES (?, ?, ?, ?, ?, 1)
        `).run(userId, address.fullName, address.phone, address.hostelBlock, address.roomNo);

        // 11. Clear user cart
        db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(userId);

        return {
          orderId: newOrderId,
          appliedCouponCode
        };
      }).immediate();

      const { orderId, appliedCouponCode } = orderTxResult;

      const createdOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as any;
      const orderItems = db.prepare(`
        SELECT oi.*, b.title, b.isbn, b.cover_image as coverImage, b.price as originalPrice
        FROM order_items oi
        LEFT JOIN books b ON oi.book_id = b.id
        WHERE oi.order_id = ?
      `).all(orderId);

      const responsePayload = {
        success: true,
        message: 'Order confirmed and inventory updated successfully.',
        order: {
          id: createdOrder.id,
          orderNumber: createdOrder.order_number,
          date: formatOrderDate(createdOrder.paid_at || createdOrder.created_at),
          paidAt: createdOrder.paid_at || null,
          createdAt: createdOrder.created_at,
          total: createdOrder.grand_total,
          summary: {
            subtotal: createdOrder.subtotal,
            couponCode: appliedCouponCode,
            couponDiscount: createdOrder.discount_amount,
            deliveryFee: createdOrder.delivery_fee,
            gstAmount: createdOrder.gst_amount,
            grandTotal: createdOrder.grand_total
          },
          status: createdOrder.status,
          paymentMethod: createdOrder.payment_method,
          paymentStatus: createdOrder.payment_status,
          address: {
            name: createdOrder.full_name,
            phone: createdOrder.phone,
            address: `${createdOrder.room_no}, ${createdOrder.hostel_block}`,
            hostelBlock: createdOrder.hostel_block,
            roomNo: createdOrder.room_no,
            notes: createdOrder.delivery_notes
          },
          items: orderItems.map((i: any) => ({
            book: {
              id: i.book_id,
              title: i.title,
              isbn: i.isbn,
              coverImage: i.coverImage,
              price: i.originalPrice
            },
            quantity: i.quantity,
            unitPrice: i.unit_price,
            lineTotal: i.line_total
          }))
        }
      };

      // Store idempotency record if key was provided
      if (cleanIdempotencyKey && requestPayloadHash) {
        try {
          db.prepare(`
            INSERT INTO idempotency_keys (user_id, key, request_hash, response_status, response_body)
            VALUES (?, ?, ?, ?, ?)
          `).run(userId, cleanIdempotencyKey, requestPayloadHash, 201, JSON.stringify(responsePayload));
        } catch (idempErr) {
          console.warn('Failed to record idempotency key:', idempErr);
        }
      }

      res.status(201).json(responsePayload);
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to process order.' });
    }
  },

  // GET /api/admin/orders
  getAdminOrders: (req: AuthRequest, res: Response) => {
    const orders = db.prepare(`
      SELECT 
        o.id,
        o.order_number as orderNumber,
        o.user_id as userId,
        u.name as customerName,
        u.email as customerEmail,
        o.full_name as recipientName,
        o.hostel_block as hostelBlock,
        o.room_no as roomNo,
        o.phone,
        o.grand_total as total,
        o.status,
        o.payment_method as payment,
        o.payment_status as paymentStatus,
        o.paid_at as paidAt,
        o.cancelled_at as cancelledAt,
        o.created_at as createdAt
      FROM orders o
      JOIN users u ON o.user_id = u.id
      ORDER BY o.created_at DESC
    `).all() as any[];

    const formattedOrders = orders.map(o => ({
      id: o.id,
      customerName: o.recipientName || o.customerName,
      room: `${o.hostelBlock}, ${o.roomNo}`,
      total: o.total,
      status: o.status,
      date: formatOrderDate(o.paidAt || o.createdAt),
      paidAt: o.paidAt || null,
      createdAt: o.createdAt,
      cancelledAt: o.cancelledAt || null,
      itemsCount: o.itemsCount,
      payment: o.payment,
      paymentStatus: o.paymentStatus
    }));

    res.json({ orders: formattedOrders });
  },

  // PUT & PATCH /api/admin/orders/:id/status
  updateOrderStatus: (req: AuthRequest, res: Response) => {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['Confirmed', 'Processing', 'Shipped', 'Delivered', 'Cancelled'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }

    try {
      const updateTx = db.transaction(() => {
        const order = db.prepare('SELECT id, status FROM orders WHERE id = ?').get(id) as any;
        if (!order) {
          return { error: 'Order not found.', status: 404 };
        }

        const currentStatus = order.status;

        // Idempotent: already at the requested status
        if (currentStatus === status) {
          return {
            success: true,
            message: `Order #${id} is already ${status}.`,
            orderId: Number(id),
            status,
            statusChanged: false
          };
        }

        // Terminal state: cancelled orders cannot be transitioned back to an active state
        if (currentStatus === 'Cancelled') {
          return {
            error: 'Cannot update status of an already cancelled order.',
            status: 400
          };
        }

        // If transitioning TO Cancelled: restore stock for all line items exactly once
        if (status === 'Cancelled') {
          const items = db.prepare(`
            SELECT book_id, quantity
            FROM order_items
            WHERE order_id = ?
          `).all(id) as any[];

          for (const item of items) {
            db.prepare('UPDATE books SET stock = stock + ? WHERE id = ?').run(item.quantity, item.book_id);
          }
        }

        // Update order status and set cancelled_at if cancelled
        if (status === 'Cancelled') {
          const cancelledAt = new Date().toISOString();
          db.prepare('UPDATE orders SET status = ?, cancelled_at = COALESCE(cancelled_at, ?) WHERE id = ?').run(status, cancelledAt, id);
        } else {
          db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, id);
        }

        return {
          success: true,
          message: `Order #${id} status updated to ${status}.`,
          orderId: Number(id),
          status,
          statusChanged: true
        };
      }).immediate();

      if (updateTx.error) {
        return res.status(updateTx.status || 400).json({ error: updateTx.error });
      }

      return res.json(updateTx);
    } catch (err: any) {
      console.error('Error updating order status:', err);
      return res.status(500).json({ error: 'Failed to update order status.' });
    }
  },

  // POST & PATCH /api/orders/:id/cancel - Student Self-Service Order Cancellation
  cancelOrder: (req: AuthRequest, res: Response) => {
    const userId = req.user?.id;
    const { id } = req.params;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required to cancel order.' });
    }

    if (!id || (typeof id === 'string' && !id.trim())) {
      return res.status(400).json({ error: 'Valid order identifier is required.' });
    }

    try {
      const cancelTx = db.transaction(() => {
        // Query order by id or order_number with exclusive immediate lock
        const order = db.prepare(`
          SELECT id, user_id, order_number, status
          FROM orders
          WHERE id = ? OR order_number = ?
        `).get(id, id) as any;

        if (!order) {
          return { error: 'Order not found.', status: 404 };
        }

        // Ownership enforcement: student can only cancel their own order
        if (order.user_id !== userId) {
          return { error: 'You are not authorized to cancel this order.', status: 403 };
        }

        const currentStatus = order.status;

        // Terminal state: already cancelled
        if (currentStatus === 'Cancelled') {
          return { error: 'Order is already cancelled.', status: 400 };
        }

        // Eligibility enforcement: only 'Confirmed' orders can be cancelled by students
        if (currentStatus !== 'Confirmed') {
          return {
            error: `Order cannot be cancelled because it is currently "${currentStatus}". Only orders in "Confirmed" status can be cancelled.`,
            status: 400
          };
        }

        // Atomic inventory restoration: restore exact purchased quantities
        const items = db.prepare(`
          SELECT book_id, quantity
          FROM order_items
          WHERE order_id = ?
        `).all(order.id) as any[];

        const restoreStockStmt = db.prepare('UPDATE books SET stock = stock + ? WHERE id = ?');
        for (const item of items) {
          restoreStockStmt.run(item.quantity, item.book_id);
        }

        const cancelledAt = new Date().toISOString();
        // Atomically update order status to Cancelled and record cancellation timestamp
        db.prepare('UPDATE orders SET status = ?, cancelled_at = ? WHERE id = ?').run('Cancelled', cancelledAt, order.id);

        return {
          success: true,
          message: `Order #${order.order_number || order.id} has been successfully cancelled and stock returned to campus inventory.`,
          orderId: order.id,
          orderNumber: order.order_number,
          status: 'Cancelled',
          statusChanged: true
        };
      }).immediate();

      if (cancelTx.error) {
        return res.status(cancelTx.status || 400).json({ error: cancelTx.error });
      }

      return res.json(cancelTx);
    } catch (err: any) {
      console.error('Error in student cancelOrder:', err);
      return res.status(500).json({ error: 'Failed to process order cancellation.' });
    }
  }
};
