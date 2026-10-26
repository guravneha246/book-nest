import { getStoredToken, setStoredToken, ApiError, request, getApiUrl } from './client';
import { authApi } from './authApi';
import { booksApi } from './booksApi';
import { cartApi } from './cartApi';
import { wishlistApi } from './wishlistApi';
import { ordersApi } from './ordersApi';
import { scannerApi } from './scannerApi';
import { recommendationsApi } from './recommendationsApi';
import { adminApi } from './adminApi';

export { getStoredToken, setStoredToken, ApiError, request, getApiUrl };
export {
  authApi,
  booksApi,
  cartApi,
  wishlistApi,
  ordersApi,
  scannerApi,
  recommendationsApi,
  adminApi,
};

/**
 * Backward-compatible unified API facade matching the exact original `api` object.
 */
export const api = {
  // Auth
  login: authApi.login,
  register: authApi.register,
  logout: authApi.logout,
  getMe: authApi.getMe,
  loginWithGoogle: authApi.loginWithGoogle,
  getDemoUsers: authApi.getDemoUsers,

  // Books & Categories
  getBooks: booksApi.getBooks,
  getBookById: booksApi.getBookById,
  getBooksByCategory: booksApi.getBooksByCategory,
  getCategories: booksApi.getCategories,

  // Cart
  getCart: cartApi.getCart,
  addToCart: cartApi.addToCart,
  updateCartQty: cartApi.updateCartQty,
  removeFromCart: cartApi.removeFromCart,
  clearCart: cartApi.clearCart,
  syncCart: cartApi.syncCart,

  // Wishlist
  getWishlist: wishlistApi.getWishlist,
  addToWishlist: wishlistApi.addToWishlist,
  removeFromWishlist: wishlistApi.removeFromWishlist,
  toggleWishlist: wishlistApi.toggleWishlist,
  syncWishlist: wishlistApi.syncWishlist,

  // Orders
  getOrders: ordersApi.getOrders,
  getOrderById: ordersApi.getOrderById,
  cancelOrder: ordersApi.cancelOrder,
  placeOrder: ordersApi.placeOrder,

  // Coupons
  validateCoupon: cartApi.validateCoupon,

  // Reviews
  getReviews: booksApi.getReviews,
  submitReview: booksApi.submitReview,
  updateReview: booksApi.updateReview,
  deleteReview: booksApi.deleteReview,

  // Recommendations & Bundles
  getBundle: recommendationsApi.getBundle,
  getAiRecommendations: recommendationsApi.getAiRecommendations,

  // Scanner
  getScannerStatus: scannerApi.getStatus,
  scanIsbn: scannerApi.scanIsbn,
  scanVision: scannerApi.scanVision,
  matchText: scannerApi.matchText,

  // Admin
  getAdminMetrics: adminApi.getAdminMetrics,
  getAdminOrders: adminApi.getAdminOrders,
  updateAdminOrderStatus: adminApi.updateAdminOrderStatus,
  addBook: adminApi.addBook,
  updateBook: adminApi.updateBook,
  updateStock: adminApi.updateStock,
  deleteBook: adminApi.deleteBook,
};
