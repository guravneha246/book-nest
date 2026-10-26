import React, { useState } from 'react';
import { Book, CartSummaryData } from '../types';
import { api } from '../api';
import { useModalA11y } from '../hooks/useModalA11y';

export interface CheckoutAddress {
  fullName: string;
  hostelBlock: string;
  roomNo: string;
  phone: string;
  deliveryNotes: string;
}

interface CheckoutFlowModalProps {
  isOpen: boolean;
  onClose: () => void;
  cart: Record<number, number>;
  books: Book[];
  summary: CartSummaryData;
  onOrderSuccess: (orderId: number, details: any) => void;
  onViewOrders?: () => void;
  currentUser?: any;
  onOpenAuth?: () => void;
}

export const CheckoutFlowModal: React.FC<CheckoutFlowModalProps> = ({
  isOpen,
  onClose,
  cart,
  books,
  summary,
  onOrderSuccess,
  onViewOrders,
  currentUser,
  onOpenAuth,
}) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [address, setAddress] = useState<CheckoutAddress>({
    fullName: currentUser?.name || 'Aditya Chauhan',
    hostelBlock: 'Aryabhata Academic Hall (Block C)',
    roomNo: 'Room 314',
    phone: currentUser?.phone || '+91 98765 43210',
    deliveryNotes: 'Please ring hostel buzzer or leave at reception desk.'
  });

  const [paymentMethod, setPaymentMethod] = useState<'upi' | 'card' | 'cod'>('upi');
  const [cardNumber, setCardNumber] = useState('4532 •••• •••• 8921');
  const [cardExpiry, setCardExpiry] = useState('08/28');
  const [cardCvv, setCardCvv] = useState('834');
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [completedOrder, setCompletedOrder] = useState<any | null>(null);

  const { modalRef } = useModalA11y({
    isOpen,
    onClose,
  });

  if (!isOpen) return null;

  const cartItems = Object.entries(cart)
    .filter(([_, qty]) => qty > 0)
    .map(([bookIdStr, qty]) => {
      const id = parseInt(bookIdStr, 10);
      const book = books.find(b => b.id === id);
      return { id, book, quantity: qty };
    })
    .filter(item => item.book !== undefined) as { id: number; book: Book; quantity: number }[];

  const validateAddress = (): boolean => {
    if (!address.fullName || address.fullName.trim().length < 2) {
      setErrorMessage('Please enter student recipient full name.');
      return false;
    }
    const cleanPhone = address.phone ? address.phone.replace(/\D/g, '') : '';
    if (cleanPhone.length < 10) {
      setErrorMessage('Please enter a valid 10-digit campus contact number.');
      return false;
    }
    if (!address.hostelBlock || address.hostelBlock.trim().length < 2) {
      setErrorMessage('Please enter your hostel residence hall or block.');
      return false;
    }
    if (!address.roomNo || address.roomNo.trim().length < 1) {
      setErrorMessage('Please enter your room or wing number.');
      return false;
    }
    setErrorMessage(null);
    return true;
  };

  const handleStep1Proceed = () => {
    if (validateAddress()) {
      setStep(2);
    }
  };

  const handlePlaceOrder = async () => {
    if (!currentUser) {
      if (onOpenAuth) onOpenAuth();
      return;
    }

    if (!validateAddress()) {
      setStep(1);
      return;
    }

    setIsProcessing(true);
    setErrorMessage(null);

    const idempotencyKey = typeof crypto !== 'undefined' && crypto.randomUUID 
      ? crypto.randomUUID() 
      : `order-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    try {
      const response = await api.placeOrder({
        address,
        paymentMethod: paymentMethod.toUpperCase(),
        items: cartItems.map(item => ({ bookId: item.book.id, quantity: item.quantity })),
        summary
      }, idempotencyKey);

      setCompletedOrder(response.order);
      onOrderSuccess(response.order.id, response.order);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to place order. Please check inventory stock.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div
      ref={modalRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="checkout-modal-title"
      className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4"
    >
      
      {/* Container Card */}
      <div className="relative w-full max-w-2xl bg-white rounded-3xl border border-slate-200/90 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Modal Top Header */}
        <div className="bg-[#FAF8F5] p-6 border-b border-slate-200/80 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[11px] font-bold text-amber-700 uppercase tracking-widest flex items-center gap-1.5">
                <i className="fa-solid fa-lock text-xs text-amber-600"></i>
                Campus Order Fulfillment
              </span>
              <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-bold">
                DEMO PAYMENT
              </span>
            </div>
            <h2 id="checkout-modal-title" className="font-serif font-black text-2xl text-slate-900">
              {completedOrder ? 'Tax Invoice & Order Manifest' : 'Campus Order Placement'}
            </h2>
          </div>

          <button
            onClick={() => {
              onClose();
              if (completedOrder && onViewOrders) onViewOrders();
            }}
            aria-label="Close checkout modal"
            className="w-9 h-9 rounded-full bg-white hover:bg-slate-100 border border-slate-200 text-slate-500 hover:text-slate-800 flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          >
            <i className="fa-solid fa-xmark text-sm"></i>
          </button>
        </div>

        {errorMessage && (
          <div role="alert" className="mx-6 mt-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
            <i className="fa-solid fa-circle-exclamation text-rose-600"></i>
            <span>{errorMessage}</span>
          </div>
        )}

        {/* ================= COMPLETED ORDER RECEIPT VIEW ================= */}
        {completedOrder ? (
          <div className="p-6 sm:p-8 space-y-6">
            
            {/* Success Celebration Banner */}
            <div className="p-5 rounded-2xl bg-emerald-50 border border-emerald-200/80 flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-emerald-500 text-white flex items-center justify-center text-xl shrink-0 shadow-md">
                <i className="fa-solid fa-check"></i>
              </div>
              <div>
                <h3 className="font-serif font-bold text-lg text-emerald-950">
                  Order Successfully Dispatched!
                </h3>
                <p className="text-xs text-emerald-800 mt-0.5">
                  Order reference <span className="font-mono font-bold">#BN-{completedOrder.orderNumber || completedOrder.id}</span> is confirmed. Expected campus delivery within 25 minutes.
                </p>
              </div>
            </div>

            {/* Printable Invoice Container */}
            <div id="printable-invoice" className="p-6 rounded-2xl bg-amber-50/40 border border-amber-200/60 font-sans text-xs space-y-4">
              <div className="flex justify-between items-start pb-4 border-b border-amber-200/60">
                <div>
                  <div className="font-serif font-black text-xl text-slate-950 flex items-center gap-1.5">
                    <span>BookNest</span>
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">Campus Central Bookstore · GSTIN: 27AABCB2026M1Z2</p>
                  <p className="text-[11px] text-slate-500">Student Delivery Manifest</p>
                </div>
                <div className="text-right">
                  <div className="font-mono font-bold text-sm text-slate-900">#BN-{completedOrder.orderNumber || completedOrder.id}</div>
                  <div className="text-slate-500 text-[11px]">
                    {completedOrder.paidAt
                      ? new Date(completedOrder.paidAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })
                      : (completedOrder.date || 'Pending Confirmation')}
                  </div>
                  <span className={`inline-block mt-1 px-2 py-0.5 rounded font-semibold text-[10px] ${
                    completedOrder.paymentStatus === 'DEMO PAID' || (completedOrder.paymentMethod && completedOrder.paymentMethod.toUpperCase() !== 'COD')
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-amber-100 text-amber-900'
                  }`}>
                    {completedOrder.paymentStatus === 'DEMO PAID' || (completedOrder.paymentMethod && completedOrder.paymentMethod.toUpperCase() !== 'COD')
                      ? `DEMO PAID (${(completedOrder.paymentMethod || 'DEMO').toUpperCase()})`
                      : 'CASH ON DELIVERY (PENDING)'}
                  </span>
                </div>
              </div>

              {/* Delivery Address & Contact */}
              <div className="grid grid-cols-2 gap-4 pb-4 border-b border-amber-200/60">
                <div>
                  <div className="font-bold text-slate-900 mb-1">Delivered To:</div>
                  <div className="text-slate-700">{completedOrder.address.name || completedOrder.address.fullName}</div>
                  <div className="text-slate-600">{completedOrder.address.hostelBlock}, {completedOrder.address.roomNo}</div>
                  <div className="text-slate-600">Contact: {completedOrder.address.phone}</div>
                </div>
                <div>
                  <div className="font-bold text-slate-900 mb-1">Fulfillment Speed:</div>
                  <div className="text-slate-700">Campus Rapid Courier</div>
                  <div className="text-slate-600">Est. Arrival: Today, 30 Mins</div>
                  <div className="text-emerald-700 font-semibold mt-1">Status: Dispatched to Hostel</div>
                </div>
              </div>

              {/* Items Manifest Table */}
              <div>
                <div className="font-bold text-slate-900 mb-2">Order Line Items:</div>
                <div className="space-y-2">
                  {completedOrder.items.map((item: any, idx: number) => (
                    <div key={idx} className="flex justify-between items-center py-1 border-b border-dashed border-amber-200/40">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-slate-400">{item.quantity}x</span>
                        <span className="font-medium text-slate-800">{item.book.title}</span>
                      </div>
                      <span className="font-mono font-bold text-slate-900">₹{item.lineTotal}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Grand Total Row */}
              <div className="pt-2 flex justify-between items-baseline font-serif text-base font-bold text-slate-950">
                <span>Grand Total (All Taxes Included)</span>
                <span className="font-mono text-xl text-amber-900">₹{completedOrder.summary?.grandTotal ?? completedOrder.total ?? 0}</span>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-3">
              <button
                onClick={handlePrint}
                className="flex-1 py-3 rounded-2xl bg-white hover:bg-slate-100 border border-slate-200 text-slate-800 font-bold text-xs flex items-center justify-center gap-2 shadow-xs transition-colors"
              >
                <i className="fa-solid fa-print text-sm text-slate-600"></i>
                <span>Print Tax Invoice</span>
              </button>

              <button
                onClick={() => {
                  onClose();
                  if (onViewOrders) onViewOrders();
                }}
                className="flex-1 py-3 rounded-2xl bg-slate-900 hover:bg-amber-600 text-amber-50 hover:text-slate-950 font-bold text-xs flex items-center justify-center gap-2 shadow-md transition-all"
              >
                <span>View All Orders</span>
                <i className="fa-solid fa-arrow-right text-xs"></i>
              </button>
            </div>

          </div>
        ) : (
          /* ================= 3-STEP CHECKOUT WIZARD ================= */
          <div className="p-6 sm:p-8">
            
            {/* Step Progress Indicators */}
            <div className="flex items-center justify-between mb-8 relative">
              <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-slate-200 -z-0 -translate-y-1/2" />
              
              {[
                { s: 1, label: 'Hostel Address', icon: 'fa-solid fa-location-dot' },
                { s: 2, label: 'Order Review', icon: 'fa-solid fa-receipt' },
                { s: 3, label: 'Payment Gateway', icon: 'fa-solid fa-credit-card' },
              ].map(({ s, label, icon }) => {
                const isPassed = step > s;
                const isCurrent = step === s;
                return (
                  <div key={s} className="relative z-10 flex flex-col items-center">
                    <button
                      onClick={() => s < step && setStep(s as any)}
                      disabled={s > step}
                      className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold transition-all shadow-xs ${
                        isCurrent
                          ? 'bg-amber-500 text-slate-950 ring-4 ring-amber-200'
                          : isPassed
                          ? 'bg-slate-900 text-white'
                          : 'bg-white border border-slate-300 text-slate-400'
                      }`}
                    >
                      <i className={icon}></i>
                    </button>
                    <span className={`text-[11px] font-medium mt-1.5 whitespace-nowrap ${
                      isCurrent ? 'text-amber-800 font-bold' : isPassed ? 'text-slate-900' : 'text-slate-400'
                    }`}>
                      {label}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* STEP 1: Campus Address */}
            {step === 1 && (
              <div className="space-y-4 animate-in fade-in duration-150">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Student Full Name
                    </label>
                    <input
                      type="text"
                      value={address.fullName}
                      onChange={(e) => setAddress({ ...address, fullName: e.target.value })}
                      className="w-full py-2.5 px-3.5 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-amber-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Campus Phone / WhatsApp
                    </label>
                    <input
                      type="text"
                      value={address.phone}
                      onChange={(e) => setAddress({ ...address, phone: e.target.value })}
                      className="w-full py-2.5 px-3.5 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-amber-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Hostel Residence / Hall
                    </label>
                    <input
                      type="text"
                      value={address.hostelBlock}
                      onChange={(e) => setAddress({ ...address, hostelBlock: e.target.value })}
                      className="w-full py-2.5 px-3.5 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-amber-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Room / Wing Number
                    </label>
                    <input
                      type="text"
                      value={address.roomNo}
                      onChange={(e) => setAddress({ ...address, roomNo: e.target.value })}
                      className="w-full py-2.5 px-3.5 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-amber-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Special Delivery Instructions
                  </label>
                  <textarea
                    rows={2}
                    value={address.deliveryNotes}
                    onChange={(e) => setAddress({ ...address, deliveryNotes: e.target.value })}
                    className="w-full py-2 px-3.5 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-amber-500 focus:outline-none resize-none"
                  />
                </div>

                <div className="pt-4 flex justify-end">
                  <button
                    onClick={handleStep1Proceed}
                    className="px-6 py-3 rounded-2xl bg-slate-900 hover:bg-amber-600 text-amber-50 hover:text-slate-950 font-bold text-xs flex items-center gap-2 shadow-md transition-all"
                  >
                    <span>Proceed to Order Review</span>
                    <i className="fa-solid fa-arrow-right text-xs"></i>
                  </button>
                </div>
              </div>
            )}

            {/* STEP 2: Order Review & Line Items */}
            {step === 2 && (
              <div className="space-y-4 animate-in fade-in duration-150">
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 max-h-56 overflow-y-auto divide-y divide-slate-200/60">
                  {cartItems.map(({ id, book, quantity }) => {
                    const finalPrice = Math.round(book.price * (1 - book.discount / 100));
                    return (
                      <div key={id} className="py-2.5 first:pt-0 last:pb-0 flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2.5">
                          <img src={book.coverImage} alt={book.title} className="w-8 h-11 object-cover rounded shadow-2xs" />
                          <div>
                            <div className="font-semibold text-slate-900 line-clamp-1">{book.title}</div>
                            <div className="text-slate-500 text-[11px]">{quantity} × ₹{finalPrice}</div>
                          </div>
                        </div>
                        <span className="font-mono font-bold text-slate-900">₹{finalPrice * quantity}</span>
                      </div>
                    );
                  })}
                </div>

                <div className="p-4 rounded-2xl bg-amber-50/70 border border-amber-200/60 text-xs space-y-1.5">
                  <div className="flex justify-between text-slate-600">
                    <span>Items Subtotal</span>
                    <span className="font-medium text-slate-900">₹{summary.subtotal}</span>
                  </div>
                  {summary.couponDiscount > 0 && (
                    <div className="flex justify-between text-emerald-700 font-medium">
                      <span>Promo Savings</span>
                      <span>-₹{summary.couponDiscount}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-slate-600">
                    <span>Campus Delivery</span>
                    <span>{summary.isFreeDelivery ? <span className="text-emerald-700 font-bold">FREE</span> : `₹${summary.deliveryFee}`}</span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-amber-200/80 font-serif text-base font-bold text-slate-950">
                    <span>Payable Grand Total</span>
                    <span>₹{summary.grandTotal}</span>
                  </div>
                </div>

                <div className="pt-4 flex items-center justify-between">
                  <button
                    onClick={() => setStep(1)}
                    className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100"
                  >
                    ← Back to Address
                  </button>
                  <button
                    onClick={() => setStep(3)}
                    className="px-6 py-3 rounded-2xl bg-slate-900 hover:bg-amber-600 text-amber-50 hover:text-slate-950 font-bold text-xs flex items-center gap-2 shadow-md transition-all"
                  >
                    <span>Proceed to Payment</span>
                    <i className="fa-solid fa-arrow-right text-xs"></i>
                  </button>
                </div>
              </div>
            )}

            {/* STEP 3: Payment Options (UPI QR / Card / COD) */}
            {step === 3 && (
              <div className="space-y-5 animate-in fade-in duration-150">
                {/* Transparent Payment Environment Notice */}
                <div className="p-3.5 rounded-2xl bg-amber-50/90 border border-amber-300 text-amber-950 text-xs flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-amber-200 text-amber-900 flex items-center justify-center shrink-0">
                    <i className="fa-solid fa-circle-info text-sm"></i>
                  </div>
                  <div>
                    <span className="font-bold block">Campus Sandbox Environment</span>
                    <span className="text-amber-800">Demo payment — no real money will be charged.</span>
                  </div>
                </div>

                {/* Payment Option Selector */}
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { id: 'upi', label: 'UPI / QR Code', icon: 'fa-solid fa-qrcode' },
                    { id: 'card', label: 'Credit / Debit Card', icon: 'fa-solid fa-credit-card' },
                    { id: 'cod', label: 'Cash on Delivery', icon: 'fa-solid fa-hand-holding-dollar' },
                  ].map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPaymentMethod(p.id as any)}
                      className={`p-3.5 rounded-2xl border text-center flex flex-col items-center gap-1.5 transition-all ${
                        paymentMethod === p.id
                          ? 'bg-amber-50 border-amber-500 ring-2 ring-amber-400 text-amber-950 font-bold shadow-xs'
                          : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-600'
                      }`}
                    >
                      <i className={`${p.icon} text-lg ${paymentMethod === p.id ? 'text-amber-600' : 'text-slate-400'}`}></i>
                      <span className="text-xs">{p.label}</span>
                    </button>
                  ))}
                </div>

                {/* Method Specific UI */}
                {paymentMethod === 'upi' && (
                  <div className="p-5 rounded-2xl bg-[#FAF8F5] border border-amber-200/70 flex flex-col items-center text-center">
                    <div className="w-32 h-32 bg-white p-2 rounded-xl shadow-md border border-slate-200 mb-3 flex items-center justify-center">
                      {/* Styled QR pattern */}
                      <div className="relative w-full h-full bg-slate-900 rounded-lg flex items-center justify-center text-white">
                        <i className="fa-solid fa-qrcode text-6xl text-amber-400"></i>
                      </div>
                    </div>
                    <p className="text-xs font-semibold text-slate-900">
                      Scan with any UPI App (GPay, PhonePe, Paytm)
                    </p>
                    <p className="text-[11px] font-mono text-slate-500 mt-0.5">
                      upi://pay?pa=booknest@campus&amp;pn=BookNest&amp;am={summary.grandTotal}
                    </p>
                  </div>
                )}

                {paymentMethod === 'card' && (
                  <div className="space-y-3 p-4 rounded-2xl bg-slate-900 text-white shadow-xl">
                    <div className="flex justify-between items-center text-xs text-amber-300 font-mono">
                      <span>CAMPUS SMART CARD</span>
                      <i className="fa-brands fa-cc-visa text-xl text-white"></i>
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-400 uppercase tracking-wider block">Card Number</label>
                      <input
                        type="text"
                        value={cardNumber}
                        onChange={(e) => setCardNumber(e.target.value)}
                        className="w-full bg-slate-800 text-amber-100 font-mono text-sm py-1.5 px-3 rounded-lg border border-slate-700 focus:outline-none"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] text-slate-400 uppercase tracking-wider block">Valid Thru</label>
                        <input
                          type="text"
                          value={cardExpiry}
                          onChange={(e) => setCardExpiry(e.target.value)}
                          className="w-full bg-slate-800 text-amber-100 font-mono text-xs py-1.5 px-3 rounded-lg border border-slate-700 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-400 uppercase tracking-wider block">CVV</label>
                        <input
                          type="password"
                          value={cardCvv}
                          onChange={(e) => setCardCvv(e.target.value)}
                          className="w-full bg-slate-800 text-amber-100 font-mono text-xs py-1.5 px-3 rounded-lg border border-slate-700 focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {paymentMethod === 'cod' && (
                  <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-center gap-3">
                    <i className="fa-solid fa-hand-holding-dollar text-2xl text-amber-600"></i>
                    <div>
                      <div className="font-bold">Pay Upon Campus Hostel Delivery</div>
                      <div className="text-[11px] text-amber-800">
                        Exact cash or UPI scan at your door. Zero advance fee.
                      </div>
                    </div>
                  </div>
                )}

                {/* Final Order Trigger */}
                <div className="pt-3 flex items-center justify-between">
                  <button
                    onClick={() => setStep(2)}
                    className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100"
                  >
                    ← Review
                  </button>

                  <button
                    onClick={handlePlaceOrder}
                    disabled={isProcessing}
                    className="px-8 py-3.5 rounded-2xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-sm shadow-md hover:shadow-xl transition-all duration-200 flex items-center gap-2.5"
                  >
                    {isProcessing ? (
                      <>
                        <i className="fa-solid fa-spinner fa-spin text-sm"></i>
                        <span>Processing Order...</span>
                      </>
                    ) : (
                      <>
                        <i className="fa-solid fa-circle-check text-sm"></i>
                        <span>Confirm &amp; Pay ₹{summary.grandTotal}</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

          </div>
        )}

      </div>
    </div>
  );
};
