import React, { useState, useMemo, useEffect } from 'react';
import { Book, UserSession, CartSummaryData, AppView } from './types';
import { INITIAL_BOOKS } from './data/bookCatalog';
import { CATALOG_CATEGORIES } from './data/categories';
import { api, getStoredToken, setStoredToken } from './api';

import { Navbar } from './components/Navbar';
import { Footer } from './components/layout/Footer';
import { ScreenReaderAnnouncer } from './components/common/ScreenReaderAnnouncer';
import { StoreHomeView } from './features/books/StoreHomeView';
import { CatalogView } from './features/books/CatalogView';
import { BookDetailPage } from './components/BookDetailPage';
import { EditorialScannerView } from './components/EditorialScannerView';
import { AdminDashboard } from './components/AdminDashboard';
import { QuickViewModal } from './components/QuickViewModal';
import { OrdersView } from './components/OrdersView';
import { WishlistView } from './components/WishlistView';
import { SlideOverCart } from './components/SlideOverCart';
import { CheckoutFlowModal } from './components/CheckoutFlowModal';
import { AuthModal } from './components/AuthModal';
import { AIReadingAdvisor } from './components/AIReadingAdvisor';

export { CATALOG_CATEGORIES, type AppView };

export function parseRouteFromHash(): { view: AppView; bookId: string | null } {
  try {
    const raw = window.location.hash.replace(/^#\/?/, '').trim();
    if (raw.startsWith('book/')) {
      const id = raw.replace(/^book\//, '').trim();
      return { view: 'book', bookId: id || null };
    }
    const clean = raw.split('/')[0];
    if (['store', 'catalog', 'scanner', 'admin', 'orders', 'wishlist'].includes(clean)) {
      return { view: clean as AppView, bookId: null };
    }
    const saved = localStorage.getItem('booknest_active_view');
    if (saved && ['store', 'catalog', 'scanner', 'admin', 'orders', 'wishlist'].includes(saved)) {
      return { view: saved as AppView, bookId: null };
    }
  } catch {}
  return { view: 'store', bookId: null };
}

export default function App() {
  // Navigation & View state (persisted across page reloads via hash and localStorage)
  const [activeView, setActiveView] = useState<AppView>(() => parseRouteFromHash().view);
  const [selectedBookId, setSelectedBookId] = useState<string | null>(() => parseRouteFromHash().bookId);

  useEffect(() => {
    try {
      if (activeView === 'book' && selectedBookId) {
        window.location.hash = `/book/${selectedBookId}`;
      } else {
        localStorage.setItem('booknest_active_view', activeView);
        window.location.hash = activeView;
      }
    } catch {}
  }, [activeView, selectedBookId]);

  // Synchronize state when browser Back / Forward or external hash changes occur
  useEffect(() => {
    const handleHashChange = () => {
      const { view, bookId } = parseRouteFromHash();
      setActiveView(view);
      setSelectedBookId(bookId);
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const navigateToBook = (bookId: number | string) => {
    setActiveView('book');
    setSelectedBookId(String(bookId));
    window.location.hash = `/book/${bookId}`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  
  // Data state
  const [books, setBooks] = useState<Book[]>(INITIAL_BOOKS);
  const [cart, setCart] = useState<Record<number, number>>(() => {
    try {
      const saved = localStorage.getItem('booknest_guest_cart');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });
  const [wishlist, setWishlist] = useState<number[]>(() => {
    try {
      const saved = localStorage.getItem('booknest_guest_wishlist');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [appliedCoupon, setAppliedCoupon] = useState<string | null>('WELCOME10');
  
  // Modals & Drawers
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [isAiAdvisorOpen, setIsAiAdvisorOpen] = useState(false);
  const [quickViewBook, setQuickViewBook] = useState<Book | null>(null);

  // Filters & Sorting in Catalog
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [maxPrice, setMaxPrice] = useState<number>(1000);
  const [sortBy, setSortBy] = useState<'featured' | 'price-asc' | 'price-desc' | 'rating' | 'discount'>('featured');
  const [stockOnly, setStockOnly] = useState(false);

  // Toast Notification state
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'info' | 'error' } | null>(null);

  // Screen-reader live announcement state
  const [announcement, setAnnouncement] = useState<string>('');

  // Placed orders list for order status viewing
  const [placedOrders, setPlacedOrders] = useState<any[]>([]);

  // Current User Session (Authentic JWT + SQLite user)
  const [currentUser, setCurrentUser] = useState<UserSession | null>(null);

  const showToast = (message: string, type: 'success' | 'info' | 'error' = 'success') => {
    setToast({ message, type });
    setAnnouncement(message);
    setTimeout(() => setToast(null), 3000);
  };

  const loadUserData = () => {
    api.getCart()
      .then(res => {
        if (res.cart) setCart(res.cart);
      })
      .catch(() => {});

    api.getWishlist()
      .then(res => {
        if (res.wishlist) setWishlist(res.wishlist);
      })
      .catch(() => {});

    api.getOrders()
      .then(res => {
        if (res.orders) setPlacedOrders(res.orders);
      })
      .catch(() => {});
  };

  // Initial Data & Auth bootstrap
  useEffect(() => {
    // 1. Fetch live catalog from database
    api.getBooks()
      .then(res => {
        if (res.books && res.books.length > 0) {
          setBooks(res.books);
        }
      })
      .catch(err => {
        console.warn('Backend catalog query warning:', err);
      });

    // 2. Handle Google OAuth redirect callback or restore active session
    const urlParams = new URLSearchParams(window.location.search);
    const oauthToken = urlParams.get('token');
    const authError = urlParams.get('auth_error');

    if (oauthToken) {
      setStoredToken(oauthToken);
      api.getMe()
        .then(res => {
          setCurrentUser(res.user);
          loadUserData();
          showToast(`Welcome back, ${res.user.name}! Signed in with Google.`, 'success');
        })
        .catch(() => {
          setStoredToken(null);
          setCurrentUser(null);
          showToast('Failed to verify Google session.', 'error');
        })
        .finally(() => {
          window.history.replaceState({}, document.title, window.location.pathname);
        });
    } else if (authError) {
      const errorMsg = authError === 'google_oauth_unconfigured'
        ? 'Google OAuth credentials are not configured in backend .env. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.'
        : `Google sign-in error: ${authError.replace(/_/g, ' ')}`;
      showToast(errorMsg, 'error');
      window.history.replaceState({}, document.title, window.location.pathname);
    } else {
      const token = getStoredToken();
      if (token) {
        api.getMe()
          .then(res => {
            setCurrentUser(res.user);
            loadUserData();
          })
          .catch(() => {
            setStoredToken(null);
            setCurrentUser(null);
          });
      }
    }
  }, []);

  const handleAuthSuccess = async (user: UserSession, _token: string) => {
    setCurrentUser(user);
    showToast(`Welcome back, ${user.name}!`, 'success');
    if (user.role === 'admin') {
      setActiveView('admin');
      setSelectedBookId(null);
      window.location.hash = 'admin';
    }
    try {
      if (Object.keys(cart).length > 0) {
        await api.syncCart(cart);
      }
      if (wishlist.length > 0) {
        await api.syncWishlist(wishlist);
      }
    } catch (e) {
      console.warn('Sync error:', e);
    }
    loadUserData();
  };

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch {}
    setStoredToken(null);
    setCurrentUser(null);
    setPlacedOrders([]);
    setCart({});
    setWishlist([]);
    localStorage.removeItem('booknest_guest_cart');
    localStorage.removeItem('booknest_guest_wishlist');
    showToast('Signed out of campus account', 'info');
    if (activeView === 'admin' || activeView === 'orders') {
      setActiveView('store');
    }
  };

  // Cart Management
  const addToCart = async (book: Book, quantity = 1) => {
    if (book.stock <= 0) {
      showToast(`"${book.title}" is currently out of stock.`, 'error');
      return;
    }

    setCart(prev => {
      const currentQty = prev[book.id] || 0;
      const updated = { ...prev, [book.id]: currentQty + quantity };
      if (!currentUser) {
        try {
          localStorage.setItem('booknest_guest_cart', JSON.stringify(updated));
        } catch {}
      }
      return updated;
    });

    if (currentUser) {
      try {
        await api.addToCart(book.id, quantity);
      } catch (err) {
        console.warn('Cart server sync warning:', err);
      }
    }

    showToast(`Added "${book.title}" to campus bag`, 'success');
  };

  const updateCartQty = async (bookId: number, qty: number) => {
    if (qty <= 0) {
      removeFromCart(bookId);
      return;
    }

    const book = books.find(b => b.id === bookId);
    if (book && qty > book.stock) {
      showToast(`Cannot add more than ${book.stock} available copies.`, 'error');
      return;
    }

    setCart(prev => {
      const updated = { ...prev, [bookId]: qty };
      if (!currentUser) {
        try {
          localStorage.setItem('booknest_guest_cart', JSON.stringify(updated));
        } catch {}
      }
      return updated;
    });

    if (currentUser) {
      try {
        await api.updateCartQty(bookId, qty);
      } catch (err) {
        console.warn('Cart server update warning:', err);
      }
    }
  };

  const removeFromCart = async (bookId: number) => {
    setCart(prev => {
      const next = { ...prev };
      delete next[bookId];
      if (!currentUser) {
        try {
          localStorage.setItem('booknest_guest_cart', JSON.stringify(next));
        } catch {}
      }
      return next;
    });

    if (currentUser) {
      try {
        await api.removeFromCart(bookId);
      } catch (err) {
        console.warn('Cart server remove warning:', err);
      }
    }
    showToast('Removed item from student bag', 'info');
  };

  const clearCart = async () => {
    setCart({});
    if (!currentUser) {
      try {
        localStorage.removeItem('booknest_guest_cart');
      } catch {}
    } else {
      try {
        await api.clearCart();
      } catch (err) {
        console.warn('Clear cart server error:', err);
      }
    }
  };

  // Wishlist Management
  const toggleWishlist = async (bookOrId: Book | number, title?: string) => {
    const bookId = typeof bookOrId === 'number' ? bookOrId : bookOrId.id;
    const bookTitle = title || (typeof bookOrId === 'object' ? bookOrId.title : books.find(b => b.id === bookId)?.title || 'Book');
    const isSaved = wishlist.includes(bookId);

    setWishlist(prev => {
      const updated = isSaved ? prev.filter(id => id !== bookId) : [...prev, bookId];
      if (!currentUser) {
        try {
          localStorage.setItem('booknest_guest_wishlist', JSON.stringify(updated));
        } catch {}
      }
      return updated;
    });

    if (currentUser) {
      try {
        await api.toggleWishlist(bookId);
      } catch (err) {
        console.warn('Wishlist server sync warning:', err);
      }
    }

    showToast(isSaved ? `Removed "${bookTitle}" from saved list` : `Saved "${bookTitle}" to wishlist`, 'info');
  };

  // Cart Calculations
  const cartItemsData = useMemo(() => {
    return Object.entries(cart).map(([bookIdStr, qty]) => {
      const bId = Number(bookIdStr);
      const book = books.find(b => b.id === bId);
      if (!book) return null;

      const discountedPrice = book.price * (1 - (book.discount || 0) / 100);
      return {
        book,
        quantity: qty,
        unitPrice: discountedPrice,
        lineTotal: discountedPrice * qty,
        originalPrice: book.price * qty,
        savings: (book.price - discountedPrice) * qty,
      };
    }).filter(Boolean) as any[];
  }, [cart, books]);

  const cartSubtotal = useMemo(() => {
    return cartItemsData.reduce((acc, item) => acc + item.lineTotal, 0);
  }, [cartItemsData]);

  const cartOriginalTotal = useMemo(() => {
    return cartItemsData.reduce((acc, item) => acc + item.originalPrice, 0);
  }, [cartItemsData]);

  const cartSavings = useMemo(() => {
    return cartOriginalTotal - cartSubtotal;
  }, [cartOriginalTotal, cartSubtotal]);

  const cartCount = useMemo(() => {
    return Object.values(cart).reduce((acc, q) => acc + q, 0);
  }, [cart]);

  const cartSummaryData: CartSummaryData = useMemo(() => {
    const freeDeliveryThreshold = 499;
    const isFree = cartSubtotal >= freeDeliveryThreshold || cartCount === 0;
    const deliveryFee = isFree ? 0 : 40;
    const amountNeeded = Math.max(0, freeDeliveryThreshold - cartSubtotal);
    const progress = Math.min(100, Math.round((cartSubtotal / freeDeliveryThreshold) * 100));

    let couponDiscount = 0;
    if (appliedCoupon === 'WELCOME10' && cartSubtotal > 0) {
      couponDiscount = Math.round(cartSubtotal * 0.10);
    } else if (appliedCoupon === 'CAMPUS20' && cartSubtotal >= 500) {
      couponDiscount = Math.round(cartSubtotal * 0.20);
    } else if (appliedCoupon === 'SCHOLAR50' && cartSubtotal >= 1000) {
      couponDiscount = 50;
    }

    const gstAmount = Math.round((cartSubtotal - couponDiscount) * 0.05);
    const grandTotal = Math.max(0, cartSubtotal - couponDiscount + deliveryFee + gstAmount);
    const totalSavings = cartSavings + couponDiscount + (isFree && cartCount > 0 ? 40 : 0);

    return {
      subtotal: cartSubtotal,
      originalTotal: cartOriginalTotal,
      itemCount: cartCount,
      deliveryFee,
      isFreeDelivery: isFree,
      amountNeededForFreeDelivery: amountNeeded,
      freeDeliveryThreshold,
      freeDeliveryProgress: progress,
      couponCode: appliedCoupon,
      couponDiscount,
      gstAmount,
      grandTotal,
      totalSavings,
    };
  }, [cartSubtotal, cartOriginalTotal, cartSavings, cartCount, appliedCoupon]);

  // Admin stock and catalogue mutation handlers
  const handleUpdateBookStock = async (bookId: number, newStock: number) => {
    try {
      const res = await api.updateStock(bookId, newStock);
      if (res.success) {
        setBooks(prev => prev.map(b => b.id === bookId ? { ...b, stock: newStock } : b));
        showToast('Inventory stock updated successfully', 'success');
      }
    } catch {
      showToast('Failed to update book inventory on server.', 'error');
    }
  };

  const handleAddBook = async (bookData: Omit<Book, 'id'>) => {
    try {
      const res = await api.addBook(bookData);
      if (res.success && res.book) {
        setBooks(prev => [res.book, ...prev]);
        showToast(`"${res.book.title}" added to campus warehouse`, 'success');
      }
    } catch {
      showToast('Failed to add book to database.', 'error');
    }
  };

  const handleDeleteBook = async (bookId: number) => {
    try {
      const res = await api.deleteBook(bookId);
      if (res.success) {
        setBooks(prev => prev.filter(b => b.id !== bookId));
        showToast('Book record removed from catalog', 'info');
      }
    } catch {
      showToast('Failed to delete book record.', 'error');
    }
  };

  const handleUpdateBook = async (updated: Book) => {
    try {
      const res = await api.updateBook(updated.id, updated);
      if (res.success && res.book) {
        setBooks(prev => prev.map(b => b.id === updated.id ? res.book : b));
        showToast(`"${res.book.title}" updated successfully`, 'success');
      }
    } catch {
      showToast('Failed to save book updates.', 'error');
    }
  };

  // Filtered books in catalog
  const filteredCatalogBooks = useMemo(() => {
    return books.filter(b => {
      if (selectedCategory !== 'all') {
        const matchesCat = b.categorySlug === selectedCategory || 
          b.category.toLowerCase().replace(/[^a-z0-9]/g, '-') === selectedCategory;
        if (!matchesCat) return false;
      }
      if (catalogSearch.trim()) {
        const q = catalogSearch.toLowerCase().trim();
        const matchesQuery = b.title.toLowerCase().includes(q) ||
          b.author.toLowerCase().includes(q) ||
          b.isbn.replace(/-/g, '').includes(q.replace(/-/g, ''));
        if (!matchesQuery) return false;
      }
      const effectivePrice = b.price * (1 - (b.discount || 0) / 100);
      if (effectivePrice > maxPrice) return false;
      if (stockOnly && b.stock <= 0) return false;
      return true;
    }).sort((a, b) => {
      const priceA = a.price * (1 - (a.discount || 0) / 100);
      const priceB = b.price * (1 - (b.discount || 0) / 100);
      if (sortBy === 'price-asc') return priceA - priceB;
      if (sortBy === 'price-desc') return priceB - priceA;
      if (sortBy === 'rating') return b.rating - a.rating;
      if (sortBy === 'discount') return (b.discount || 0) - (a.discount || 0);
      return (b.featured ? 1 : 0) - (a.featured ? 1 : 0);
    });
  }, [books, selectedCategory, catalogSearch, maxPrice, stockOnly, sortBy]);

  // Featured and curated selections
  const featuredBook = useMemo(() => {
    return books.find(b => b.featured) || books[0] || null;
  }, [books]);

  const featuredBooks = useMemo(() => {
    return books.filter(b => b.featured).slice(0, 4);
  }, [books]);

  const popularBooks = useMemo(() => {
    return [...books].sort((a, b) => b.rating - a.rating).slice(0, 4);
  }, [books]);

  const newArrivals = useMemo(() => {
    return [...books]
      .sort((a, b) => (b.year || 2024) - (a.year || 2024) || b.id - a.id)
      .slice(0, 4);
  }, [books]);

  const avgCatalogRating = useMemo(() => {
    if (books.length === 0) return 4.8;
    return books.reduce((acc, b) => acc + b.rating, 0) / books.length;
  }, [books]);

  return (
    <div className="min-h-screen bg-[#FAF8F5] text-slate-900 font-sans selection:bg-amber-200 selection:text-slate-950 flex flex-col">
      
      {/* Skip to Main Content Link for keyboard & screen reader accessibility */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:px-4 focus:py-2 focus:bg-amber-500 focus:text-slate-950 focus:font-bold focus:rounded-xl focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
      >
        Skip to main content
      </a>

      {/* Screen Reader Live Region Announcer */}
      <ScreenReaderAnnouncer message={announcement} />

      {/* Global Sticky Navigation */}
      <Navbar
        books={books}
        activeView={activeView}
        cartCount={cartSummaryData.itemCount}
        wishlistCount={wishlist.length}
        currentUser={currentUser}
        onNavigate={(view) => {
          setActiveView(view);
          setSelectedBookId(null);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onOpenCart={() => setIsCartOpen(true)}
        onSelectBook={(book) => setQuickViewBook(book)}
        onOpenAuth={() => setIsAuthOpen(true)}
        onLogout={handleLogout}
        onOpenAiAdvisor={() => setIsAiAdvisorOpen(true)}
      />

      {/* ================= VIEW: HOME STOREFRONT ================= */}
      {activeView === 'store' && (
        <StoreHomeView
          books={books}
          featuredBook={featuredBook || books[0]}
          featuredBooks={featuredBooks}
          popularBooks={popularBooks}
          newArrivals={newArrivals}
          avgCatalogRating={avgCatalogRating}
          selectedCategory={selectedCategory}
          wishlist={wishlist}
          onSelectCategory={setSelectedCategory}
          onNavigate={(view) => {
            setActiveView(view);
            setSelectedBookId(null);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          onOpenAiAdvisor={() => setIsAiAdvisorOpen(true)}
          onAddToCart={addToCart}
          onQuickView={(book) => setQuickViewBook(book)}
          onToggleWishlist={toggleWishlist}
        />
      )}

      {/* ================= VIEW: BOOK CATALOG ================= */}
      {activeView === 'catalog' && (
        <CatalogView
          filteredCatalogBooks={filteredCatalogBooks}
          selectedCategory={selectedCategory}
          setSelectedCategory={setSelectedCategory}
          catalogSearch={catalogSearch}
          setCatalogSearch={setCatalogSearch}
          maxPrice={maxPrice}
          setMaxPrice={setMaxPrice}
          sortBy={sortBy}
          setSortBy={setSortBy}
          stockOnly={stockOnly}
          setStockOnly={setStockOnly}
          wishlist={wishlist}
          onAddToCart={addToCart}
          onToggleWishlist={toggleWishlist}
          onQuickView={(b) => setQuickViewBook(b)}
        />
      )}

      {/* ================= VIEW: OPTICAL SCANNER ================= */}
      {activeView === 'scanner' && (
        <main id="main-content" tabIndex={-1} className="flex-1 focus:outline-none">
          <EditorialScannerView
            books={books}
            onAddToCart={addToCart}
            onQuickView={(b) => setQuickViewBook(b)}
            onToggleWishlist={toggleWishlist}
          />
        </main>
      )}

      {/* ================= VIEW: ADMIN DASHBOARD ================= */}
      {activeView === 'admin' && (
        <main id="main-content" tabIndex={-1} className="flex-1 focus:outline-none">
          {currentUser?.role === 'admin' ? (
            <AdminDashboard
              books={books}
              onUpdateBookStock={handleUpdateBookStock}
              onAddBook={handleAddBook}
              onDeleteBook={handleDeleteBook}
              onUpdateBook={handleUpdateBook}
            />
          ) : (
            <div className="max-w-md mx-auto my-16 p-8 bg-white rounded-3xl border border-slate-200 shadow-xl text-center space-y-4">
              <div className="w-16 h-16 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mx-auto text-2xl">
                <i className="fa-solid fa-shield-halved"></i>
              </div>
              <h2 className="font-serif font-bold text-2xl text-slate-900">Administrator Access Required</h2>
              <p className="text-xs text-slate-600 leading-relaxed">
                You must be authenticated with verified administrative credentials (admin@booknest.com) to access the warehouse control tower.
              </p>
              <button
                onClick={() => setIsAuthOpen(true)}
                className="w-full py-3 rounded-xl bg-slate-900 hover:bg-amber-600 text-amber-50 hover:text-slate-950 font-bold text-xs shadow-md transition-colors cursor-pointer"
              >
                Sign In as Administrator
              </button>
            </div>
          )}
        </main>
      )}

      {/* ================= VIEW: STUDENT ORDERS ================= */}
      {activeView === 'orders' && (
        <main id="main-content" tabIndex={-1} className="flex-1 focus:outline-none">
          <OrdersView
            orders={placedOrders}
            onNavigateToCatalog={() => setActiveView('catalog')}
            onOrderAgain={(book) => addToCart(book)}
            onCancelOrder={async (orderId) => {
              try {
                await api.cancelOrder(orderId);
                loadUserData();
                showToast('Order cancelled successfully', 'info');
              } catch (err: any) {
                showToast(err.message || 'Failed to cancel order', 'error');
              }
            }}
            onRefreshOrders={loadUserData}
            showToast={showToast}
          />
        </main>
      )}

      {/* ================= VIEW: WISHLIST ================= */}
      {activeView === 'wishlist' && (
        <main id="main-content" tabIndex={-1} className="flex-1 focus:outline-none">
          <WishlistView
            wishlist={wishlist}
            books={books}
            onMoveToCart={(book) => {
              addToCart(book);
              toggleWishlist(book.id);
            }}
            onRemoveFromWishlist={(bookId, title) => {
              toggleWishlist(bookId, title);
            }}
            onAddAllToCart={() => {
              const savedBooks = books.filter(b => wishlist.includes(b.id) && b.stock > 0);
              savedBooks.forEach(b => addToCart(b));
              showToast(`Added ${savedBooks.length} saved books to bag`, 'success');
            }}
            onNavigateToCatalog={() => setActiveView('catalog')}
            onOpenBookDetail={(book) => navigateToBook(book.id)}
          />
        </main>
      )}

      {/* ================= VIEW: DEDICATED BOOK DETAIL PAGE ================= */}
      {activeView === 'book' && selectedBookId && (
        <main id="main-content" tabIndex={-1} className="flex-1 focus:outline-none">
          <BookDetailPage
            bookId={selectedBookId}
            allBooks={books}
            wishlist={wishlist}
            currentUser={currentUser}
            onAddToCart={addToCart}
            onToggleWishlist={toggleWishlist}
            onNavigateToCatalog={() => setActiveView('catalog')}
            onNavigateToHome={() => setActiveView('store')}
            onSelectCategory={(cat) => {
              setSelectedCategory(cat);
              setActiveView('catalog');
            }}
            onOpenBookDetail={(id) => navigateToBook(id)}
            onOpenAuth={() => setIsAuthOpen(true)}
            showToast={showToast}
          />
        </main>
      )}

      {/* ================= MODAL: QUICK VIEW ================= */}
      {quickViewBook && (
        <QuickViewModal
          book={quickViewBook}
          onClose={() => setQuickViewBook(null)}
          isWishlisted={wishlist.includes(quickViewBook.id)}
          onToggleWishlist={toggleWishlist}
          onAddToCart={(b, q) => addToCart(b, q)}
          currentUser={currentUser}
          onOpenAuth={() => setIsAuthOpen(true)}
          allBooks={books}
          onSelectBook={(b) => setQuickViewBook(b)}
          onViewFullDetails={(b) => navigateToBook(b.id)}
        />
      )}

      {/* ================= DRAWER: SLIDE-OVER SHOPPING BAG ================= */}
      <SlideOverCart
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        cart={cart}
        books={books}
        summary={cartSummaryData}
        appliedCoupon={appliedCoupon}
        onUpdateQty={updateCartQty}
        onRemoveItem={(bookId, title) => {
          removeFromCart(bookId);
          showToast(`Removed "${title}" from student bag`, 'info');
        }}
        onApplyCoupon={(code) => {
          setAppliedCoupon(code);
          showToast(`Applied promo coupon "${code}"`, 'success');
        }}
        onRemoveCoupon={() => {
          setAppliedCoupon(null);
          showToast('Removed promo coupon', 'info');
        }}
        onProceedToCheckout={() => {
          setIsCartOpen(false);
          setIsCheckoutOpen(true);
        }}
        onNavigateToCatalog={() => {
          setIsCartOpen(false);
          setActiveView('catalog');
        }}
        onOpenBookDetail={(book) => {
          setIsCartOpen(false);
          navigateToBook(book.id);
        }}
      />

      {/* ================= MODAL: CHECKOUT FLOW ================= */}
      <CheckoutFlowModal
        isOpen={isCheckoutOpen}
        onClose={() => setIsCheckoutOpen(false)}
        cart={cart}
        books={books}
        summary={cartSummaryData}
        currentUser={currentUser}
        onOrderSuccess={(orderId, details) => {
          setPlacedOrders(prev => [details, ...prev]);
          clearCart();
          showToast(`Order #${details?.orderNumber || orderId} confirmed! Sent to hostel warehouse.`, 'success');
        }}
        onViewOrders={() => {
          setIsCheckoutOpen(false);
          setActiveView('orders');
        }}
        onOpenAuth={() => setIsAuthOpen(true)}
      />

      {/* ================= MODAL: AUTHENTICATION & REGISTRATION ================= */}
      <AuthModal
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
        onAuthSuccess={handleAuthSuccess}
      />

      {/* ================= MODAL: AI READING ADVISOR ================= */}
      <AIReadingAdvisor
        isOpen={isAiAdvisorOpen}
        onClose={() => setIsAiAdvisorOpen(false)}
        currentUser={currentUser}
        allBooks={books}
        wishlist={wishlist}
        onToggleWishlist={toggleWishlist}
        onAddToCart={addToCart}
        onQuickView={(book) => setQuickViewBook(book)}
        onOpenAuth={() => setIsAuthOpen(true)}
      />

      {/* ================= TOAST NOTIFICATION ================= */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-2xl shadow-xl flex items-center gap-3 text-xs font-semibold border backdrop-blur-md transition-all animate-in fade-in slide-in-from-bottom-5 ${
            toast.type === 'error'
              ? 'bg-rose-950 text-white border-rose-800'
              : toast.type === 'info'
              ? 'bg-slate-900 text-amber-200 border-slate-700'
              : 'bg-slate-950 text-white border-slate-800'
          }`}
        >
          <i className={`fa-solid ${
            toast.type === 'error' ? 'fa-circle-xmark text-rose-400' :
            toast.type === 'info' ? 'fa-circle-info text-amber-400' :
            'fa-circle-check text-emerald-400'
          } text-sm`} aria-hidden="true"></i>
          <span>{toast.message}</span>
        </div>
      )}

      {/* ================= EDITORIAL FOOTER ================= */}
      <Footer onNavigate={(view) => {
        setActiveView(view);
        setSelectedBookId(null);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }} />

    </div>
  );
}
