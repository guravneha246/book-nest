import React, { useState } from 'react';
import { Package, Truck, Check, Clock, ArrowRight, Printer, X, FileText, ChevronRight, AlertTriangle } from 'lucide-react';
import { Book } from '../types';
import { api } from '../api';
import { useModalA11y } from '../hooks/useModalA11y';

export interface PlacedOrder {
  id: string | number;
  date: string;
  total?: number;
  totalAmount?: number;
  status: 'Confirmed' | 'Processing' | 'Shipped' | 'Delivered' | 'Cancelled';
  paymentMethod: string;
  items: { book: Book; quantity: number; price: number }[];
  address?: {
    name?: string;
    fullName?: string;
    phone?: string;
    address?: string;
    hostelBlock?: string;
    roomNo?: string;
    city?: string;
    pincode?: string;
    deliveryNotes?: string;
  };
}

interface OrdersViewProps {
  orders: PlacedOrder[];
  onNavigateToCatalog: () => void;
  onOrderAgain: (book: Book) => void;
  onCancelOrder?: (orderId: string | number) => Promise<boolean | void>;
  onRefreshOrders?: () => void;
  showToast?: (message: string, type?: 'success' | 'info' | 'error') => void;
}

export const OrdersView: React.FC<OrdersViewProps> = ({
  orders,
  onNavigateToCatalog,
  onOrderAgain,
  onCancelOrder,
  onRefreshOrders,
  showToast
}) => {
  const [selectedInvoice, setSelectedInvoice] = useState<PlacedOrder | null>(null);
  const [confirmingCancelOrder, setConfirmingCancelOrder] = useState<PlacedOrder | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelSuccessMsg, setCancelSuccessMsg] = useState<string | null>(null);

  const handleConfirmCancel = async () => {
    if (!confirmingCancelOrder || isCancelling) return;
    setIsCancelling(true);
    setCancelError(null);

    try {
      if (onCancelOrder) {
        await onCancelOrder(confirmingCancelOrder.id);
      } else {
        const res = await api.cancelOrder(confirmingCancelOrder.id);
        if (showToast) {
          showToast(res.message || 'Order successfully cancelled.', 'success');
        }
        if (onRefreshOrders) {
          onRefreshOrders();
        }
      }
      setCancelSuccessMsg(`Order #${(confirmingCancelOrder as any).orderNumber || confirmingCancelOrder.id} has been cancelled.`);
      setTimeout(() => {
        setConfirmingCancelOrder(null);
        setCancelSuccessMsg(null);
      }, 1000);
    } catch (err: any) {
      setCancelError(err.message || 'Failed to cancel order. Please refresh and try again.');
    } finally {
      setIsCancelling(false);
    }
  };

  if (orders.length === 0) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <div className="bg-white border border-[#E8E5DF] rounded-3xl p-12 max-w-lg mx-auto shadow-sm">
          <div className="w-20 h-20 bg-blue-50 text-blue-900 rounded-full flex items-center justify-center mx-auto mb-6 text-3xl">
            📦
          </div>
          <h2 className="font-serif text-2xl font-bold text-zinc-900 mb-2">
            No orders yet. Your next read could be here.
          </h2>
          <p className="text-sm text-zinc-500 mb-8 max-w-sm mx-auto leading-relaxed">
            When you complete checkout, your order confirmation, dispatch tracking, and printable GST tax invoices will appear here.
          </p>
          <button
            onClick={onNavigateToCatalog}
            className="px-6 py-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-sm transition-all shadow-md inline-flex items-center gap-2"
          >
            <span>Explore Bookstore</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
      
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="font-serif text-3xl font-bold text-zinc-900">
            My Orders
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            {orders.length} {orders.length === 1 ? 'order' : 'orders'} placed with campus tracking
          </p>
        </div>

        <button
          onClick={onNavigateToCatalog}
          className="px-4 py-2 rounded-xl bg-zinc-100 hover:bg-zinc-200 text-zinc-800 font-semibold text-xs transition-all flex items-center gap-1.5"
        >
          <span>+ Browse More Books</span>
        </button>
      </div>

      {/* Orders List */}
      <div className="space-y-6">
        {orders.map((order) => (
          <div
            key={order.id}
            data-testid="order-card"
            className="bg-white border border-[#E8E5DF] rounded-3xl overflow-hidden shadow-sm hover:shadow-md transition-shadow"
          >
            {/* Order Card Header */}
            <div className="bg-zinc-50 border-b border-[#E8E5DF] p-5 flex flex-wrap items-center justify-between gap-4 text-xs">
              <div className="flex flex-wrap gap-6 sm:gap-10">
                <div>
                  <span className="text-zinc-400 block font-medium">ORDER PLACED</span>
                  <span className="font-semibold text-zinc-900">{order.date}</span>
                  {(order as any).paidAt && (
                    <span className="text-[10px] text-emerald-700 block font-medium">
                      Paid: {new Date((order as any).paidAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "short", timeStyle: "short" })}
                    </span>
                  )}
                </div>
                <div>
                  <span className="text-zinc-400 block font-medium">TOTAL AMOUNT</span>
                  <span className="font-bold text-zinc-900">₹{order.total || (order as any).totalAmount || 0}</span>
                </div>
                <div>
                  <span className="text-zinc-400 block font-medium">SHIP TO</span>
                  <span className="font-semibold text-zinc-900">{order.address?.name || 'Campus Student'}</span>
                </div>
                <div>
                  <span className="text-zinc-400 block font-medium">PAYMENT</span>
                  <span className="font-semibold text-zinc-700">{order.paymentMethod}</span>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <span className="font-mono font-bold text-blue-900 bg-blue-50 px-2.5 py-1 rounded-md border border-blue-100">
                  {(order as any).orderNumber || (typeof order.id === 'number' ? `BN-${order.id}` : order.id)}
                </span>

                {/* Cancel Order Action - strictly eligible for Confirmed orders */}
                {order.status === 'Confirmed' && (
                  <button
                    type="button"
                    data-testid="cancel-order-btn"
                    onClick={() => {
                      setCancelError(null);
                      setCancelSuccessMsg(null);
                      setConfirmingCancelOrder(order);
                    }}
                    className="px-3 py-1.5 rounded-lg border border-rose-200 bg-rose-50/70 hover:bg-rose-100 text-rose-700 font-semibold flex items-center gap-1.5 transition-colors text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
                    aria-label={`Cancel order ${(order as any).orderNumber || order.id}`}
                  >
                    <X className="w-3.5 h-3.5 text-rose-600" />
                    <span>Cancel Order</span>
                  </button>
                )}

                <button
                  onClick={() => setSelectedInvoice(order)}
                  className="px-3 py-1.5 rounded-lg border border-zinc-200 hover:bg-white text-zinc-700 font-medium flex items-center gap-1.5 transition-colors"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Invoice</span>
                </button>
              </div>
            </div>

            {/* Tracking progress bar */}
            <div className="p-6 border-b border-zinc-100">
              {order.status === 'Cancelled' ? (
                <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2 text-rose-700 font-bold">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse"></span>
                    <span data-testid="order-status-badge">Order Cancelled</span>
                  </div>
                  <span className="text-rose-600 font-medium">All items returned to campus bookstore inventory</span>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between text-xs mb-3 font-semibold">
                    <div className="flex items-center gap-2 text-emerald-600">
                      <Check className="w-4 h-4" />
                      <span data-testid="order-status-badge">{order.status}</span>
                    </div>
                    <span className="text-zinc-400">Estimated Delivery in 2-4 business days</span>
                  </div>

                  <div className="grid grid-cols-4 gap-2 text-center text-[11px]">
                    <div className="p-2 rounded-xl bg-emerald-50 text-emerald-800 font-bold border border-emerald-200">
                      ✓ Confirmed
                    </div>
                    <div className={`p-2 rounded-xl border ${order.status === 'Processing' || order.status === 'Shipped' || order.status === 'Delivered' ? 'bg-emerald-50 text-emerald-800 font-bold border-emerald-200' : order.status === 'Confirmed' ? 'bg-blue-50 text-blue-900 font-bold border-blue-200' : 'bg-zinc-50 text-zinc-400 border-zinc-200'}`}>
                      📦 Processing
                    </div>
                    <div className={`p-2 rounded-xl border ${order.status === 'Shipped' || order.status === 'Delivered' ? 'bg-emerald-50 text-emerald-800 font-bold border-emerald-200' : 'bg-zinc-50 text-zinc-400 border-zinc-200'}`}>
                      🚚 Dispatched
                    </div>
                    <div className={`p-2 rounded-xl border ${order.status === 'Delivered' ? 'bg-emerald-50 text-emerald-800 font-bold border-emerald-200' : 'bg-zinc-50 text-zinc-400 border-zinc-200'}`}>
                      🏁 Delivered
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Item Rows */}
            <div className="p-6 divide-y divide-zinc-100">
              {order.items.map(({ book, quantity, price }) => (
                <div key={book.id} className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <img
                      src={book.coverImage}
                      alt={book.title}
                      className="w-12 h-16 object-cover rounded-md border border-zinc-200 flex-shrink-0"
                    />
                    <div>
                      <h4 className="font-bold text-sm text-zinc-900 line-clamp-1">{book.title}</h4>
                      <p className="text-xs text-zinc-500">by {book.author}</p>
                      <span className="text-xs text-zinc-400 font-mono">
                        Qty: {quantity} × ₹{price}
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={() => onOrderAgain(book)}
                    className="px-3 py-1.5 rounded-lg bg-blue-50 text-blue-900 hover:bg-blue-100 text-xs font-semibold transition-colors flex-shrink-0"
                  >
                    Buy Again
                  </button>
                </div>
              ))}
            </div>

          </div>
        ))}
      </div>

      {/* Invoice Modal */}
      {selectedInvoice && (
        <InvoiceModal
          order={selectedInvoice}
          onClose={() => setSelectedInvoice(null)}
        />
      )}

      {/* Cancellation Confirmation Modal */}
      {confirmingCancelOrder && (
        <CancelOrderModal
          order={confirmingCancelOrder}
          isCancelling={isCancelling}
          cancelError={cancelError}
          cancelSuccessMsg={cancelSuccessMsg}
          onClose={() => {
            if (!isCancelling) {
              setConfirmingCancelOrder(null);
              setCancelError(null);
            }
          }}
          onConfirm={handleConfirmCancel}
        />
      )}

    </div>
  );
};

interface InvoiceModalProps {
  order: PlacedOrder;
  onClose: () => void;
}

const InvoiceModal: React.FC<InvoiceModalProps> = ({ order, onClose }) => {
  const { modalRef } = useModalA11y({
    isOpen: true,
    onClose,
  });

  return (
    <div
      ref={modalRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="invoice-modal-title"
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200"
    >
      <div className="bg-white rounded-3xl max-w-2xl w-full p-6 sm:p-8 shadow-2xl relative max-h-[90vh] overflow-y-auto border border-[#E8E5DF]">
        <button
          onClick={onClose}
          aria-label="Close invoice dialog"
          className="absolute top-5 right-5 w-8 h-8 rounded-full bg-zinc-100 hover:bg-zinc-200 text-zinc-500 flex items-center justify-center font-bold"
        >
          ✕
        </button>

        <div className="flex items-center justify-between pb-4 border-b border-zinc-100 mb-6">
          <div>
            <h2 id="invoice-modal-title" className="font-serif text-2xl font-bold text-zinc-900">
              BookNest Tax Invoice
            </h2>
            <div className="text-xs text-zinc-500">
              Official original buyer receipt • Order {order.id}
            </div>
          </div>
          <button
            onClick={() => window.print()}
            aria-label="Print tax invoice"
            className="px-3 py-1.5 rounded-lg bg-zinc-100 hover:bg-zinc-200 text-xs font-semibold flex items-center gap-1.5"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print</span>
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4 bg-zinc-50 p-4 rounded-2xl border border-zinc-200 text-xs mb-6">
          <div>
            <span className="text-zinc-400 block font-medium">Billed & Shipped To:</span>
            <strong className="text-zinc-900 text-sm block mt-0.5">{order.address?.name || 'Campus Student'}</strong>
            <div className="text-zinc-600 mt-1">{order.address?.address || order.address?.hostelBlock || 'University Campus'}</div>
            <div className="text-zinc-600">
              {order.address?.city ? `${order.address.city} - ${order.address?.pincode || ''}` : order.address?.roomNo || ''}
            </div>
            <div className="text-zinc-500 mt-1">📞 {order.address?.phone || '+91 98765 43210'}</div>
          </div>

          <div>
            <span className="text-zinc-400 block font-medium">Invoice Details:</span>
            <div className="mt-1 space-y-1">
              <div><strong>Invoice Date:</strong> {order.date}</div>
              {(order as any).paidAt && (
                <div><strong>Payment Confirmed (IST):</strong> {new Date((order as any).paidAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}</div>
              )}
              <div><strong>Payment Mode:</strong> {order.paymentMethod}</div>
              <div><strong>Delivery Mode:</strong> Regional Express Campus Dispatch</div>
              <div><strong>GST Compliance:</strong> 07AAAAA0000A1Z5</div>
            </div>
          </div>
        </div>

        <table className="w-full text-xs mb-6">
          <thead>
            <tr className="border-b-2 border-zinc-200 text-zinc-400 text-left uppercase">
              <th className="py-2">Item</th>
              <th className="py-2 text-center">Qty</th>
              <th className="py-2 text-right">Price</th>
              <th className="py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {order.items.map(({ book, quantity, price }) => (
              <tr key={book.id}>
                <td className="py-3 font-semibold text-zinc-900">
                  {book.title}
                  <span className="block text-[10px] text-zinc-400 font-normal">by {book.author}</span>
                </td>
                <td className="py-3 text-center">{quantity}</td>
                <td className="py-3 text-right">₹{price}</td>
                <td className="py-3 text-right font-bold">₹{price * quantity}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-zinc-200 font-bold text-sm">
              <td colSpan={3} className="pt-3 text-right text-zinc-600">Grand Total:</td>
              <td className="pt-3 text-right text-blue-900 text-base">₹{order.total}</td>
            </tr>
          </tfoot>
        </table>

        <div className="text-[11px] text-zinc-400 text-center border-t border-zinc-100 pt-4">
          Thank you for supporting BookNest campus bookstore! All rights reserved.
        </div>
      </div>
    </div>
  );
};

interface CancelOrderModalProps {
  order: PlacedOrder;
  isCancelling: boolean;
  cancelError: string | null;
  cancelSuccessMsg: string | null;
  onClose: () => void;
  onConfirm: () => void;
}

const CancelOrderModal: React.FC<CancelOrderModalProps> = ({
  order,
  isCancelling,
  cancelError,
  cancelSuccessMsg,
  onClose,
  onConfirm,
}) => {
  const { modalRef } = useModalA11y({
    isOpen: true,
    onClose,
    autoFocusSelector: '[data-testid="confirm-cancel-btn"]',
  });

  return (
    <div
      ref={modalRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="cancel-order-modal-title"
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200"
    >
      <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-8 shadow-2xl relative border border-[#E8E5DF] space-y-5">
        <button
          type="button"
          onClick={onClose}
          disabled={isCancelling}
          className="absolute top-5 right-5 w-8 h-8 rounded-full bg-zinc-100 hover:bg-zinc-200 text-zinc-500 flex items-center justify-center font-bold transition-colors disabled:opacity-50"
          aria-label="Close cancel order dialog"
        >
          ✕
        </button>

        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center text-xl shrink-0">
            <AlertTriangle className="w-6 h-6 text-rose-600" />
          </div>
          <div>
            <h3 id="cancel-order-modal-title" className="font-serif font-bold text-xl text-zinc-900">
              Cancel Campus Order?
            </h3>
            <p className="text-xs text-zinc-500 font-mono mt-0.5">
              Order #{(order as any).orderNumber || order.id}
            </p>
          </div>
        </div>

        <p className="text-xs text-zinc-600 leading-relaxed">
          Are you sure you want to cancel this order? All textbook items will be returned to campus inventory and student dispatch will be terminated. This action cannot be reversed.
        </p>

        {/* Item summary */}
        <div className="bg-zinc-50 rounded-2xl p-3.5 border border-zinc-200 text-xs space-y-1.5 max-h-36 overflow-y-auto">
          <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Items to be Restored to Stock</span>
          {order.items.map(({ book, quantity }) => (
            <div key={book.id} className="flex items-center justify-between text-zinc-700">
              <span className="truncate max-w-[240px] font-medium">{book.title}</span>
              <span className="font-mono text-zinc-500 font-semibold">Qty: {quantity}</span>
            </div>
          ))}
        </div>

        {/* Error Banner */}
        {cancelError && (
          <div role="alert" className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs flex items-start gap-2">
            <span className="font-bold text-rose-600">Notice:</span>
            <span>{cancelError}</span>
          </div>
        )}

        {/* Success Banner */}
        {cancelSuccessMsg && (
          <div role="status" aria-live="polite" className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-600" />
            <span>{cancelSuccessMsg}</span>
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            disabled={isCancelling}
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-zinc-200 hover:bg-zinc-50 text-zinc-700 font-semibold text-xs transition-colors disabled:opacity-50"
          >
            Keep Order
          </button>

          <button
            type="button"
            data-testid="confirm-cancel-btn"
            disabled={isCancelling}
            onClick={onConfirm}
            className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-sm transition-colors flex items-center gap-1.5 disabled:opacity-50"
          >
            {isCancelling ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin"></span>
                <span>Cancelling...</span>
              </>
            ) : (
              <>
                <X className="w-3.5 h-3.5" />
                <span>Confirm Cancellation</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
