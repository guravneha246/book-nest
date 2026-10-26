import React, { useState, useRef, useEffect } from 'react';
import { Book } from '../types';
import { api } from '../api';

export type ScannerMode = 'camera' | 'upload' | 'demo' | 'manual';
export type ScannerState = 
  | 'idle' 
  | 'camera-starting' 
  | 'camera-ready' 
  | 'captured' 
  | 'processing' 
  | 'isbn-detected' 
  | 'ocr-processing' 
  | 'searching' 
  | 'matched' 
  | 'not-stocked'
  | 'multiple-matches' 
  | 'text-unclear'
  | 'no-book-detected'
  | 'vision-unconfigured'
  | 'camera-denied'
  | 'camera-unavailable'
  | 'invalid-image'
  | 'no-match' 
  | 'error';

interface MatchCandidate {
  book: Book;
  confidence: number;
  matchType: string;
  evidence: string;
}

interface EditorialScannerViewProps {
  books: Book[];
  onAddToCart: (book: Book, quantity?: number) => void;
  onQuickView: (book: Book) => void;
  onToggleWishlist?: (bookId: number, title?: string) => void;
}

export const EditorialScannerView: React.FC<EditorialScannerViewProps> = ({
  books,
  onAddToCart,
  onQuickView,
  onToggleWishlist,
}) => {
  // Scanner state machine
  const [scannerState, setScannerState] = useState<ScannerState>('idle');
  const [scannerMode, setScannerMode] = useState<ScannerMode>('camera');

  // Camera & Image preview states
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewMimeType, setPreviewMimeType] = useState<string>('image/jpeg');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);

  // Result state
  const [matchedBook, setMatchedBook] = useState<Book | null>(null);
  const [matchType, setMatchType] = useState<string | null>(null);
  const [calculatedConfidence, setCalculatedConfidence] = useState<number | null>(null);
  const [matchEvidence, setMatchEvidence] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<MatchCandidate[]>([]);
  const [detectedMetadata, setDetectedMetadata] = useState<any | null>(null);

  // Manual search query state
  const [manualQuery, setManualQuery] = useState('');
  const [isVisionConfigured, setIsVisionConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    if (api.getScannerStatus) {
      api.getScannerStatus()
        .then((res: any) => {
          setIsVisionConfigured(Boolean(res?.visionConfigured));
        })
        .catch(() => {
          setIsVisionConfigured(false);
        });
    }
  }, []);

  const fallbackSamples: Book[] = [
    {
      id: 1,
      title: 'Clean Code',
      author: 'Robert C. Martin',
      isbn: '9780132350884',
      price: 899,
      discount: 15,
      stock: 12,
      rating: 4.8,
      pages: 464,
      year: 2008,
      language: 'English',
      publisher: 'Prentice Hall',
      category: 'Engineering',
      categorySlug: 'engineering',
      coverImage: 'https://images.unsplash.com/photo-1532012164546-f432f2e3777f?auto=format&fit=crop&q=80&w=600',
      description: 'Even bad code can function. But if code isn\'t clean, it can bring a development organization to its knees.'
    },
    {
      id: 2,
      title: 'Atomic Habits',
      author: 'James Clear',
      isbn: '9780735211292',
      price: 650,
      discount: 20,
      stock: 8,
      rating: 4.9,
      pages: 320,
      year: 2018,
      language: 'English',
      publisher: 'Avery',
      category: 'Self-Help',
      categorySlug: 'self-help',
      coverImage: 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?auto=format&fit=crop&q=80&w=600',
      description: 'An easy & proven way to build good habits & break bad ones.'
    },
    {
      id: 3,
      title: 'The Pragmatic Programmer',
      author: 'David Thomas, Andrew Hunt',
      isbn: '9780201616224',
      price: 920,
      discount: 10,
      stock: 5,
      rating: 4.8,
      pages: 352,
      year: 1999,
      language: 'English',
      publisher: 'Addison-Wesley',
      category: 'Engineering',
      categorySlug: 'engineering',
      coverImage: 'https://images.unsplash.com/photo-1512820790803-83ca734da794?auto=format&fit=crop&q=80&w=600',
      description: 'Your journey to mastery in software craftsmanship.'
    }
  ];

  const displaySamples = (books && books.length > 0) ? books.slice(0, 4) : fallbackSamples;

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const barcodeScanIntervalRef = useRef<any>(null);
  const isScanningRef = useRef<boolean>(false);

  // BUG 1: Synchronized ref to prevent stale React closures inside barcode intervals
  const scannerStateRef = useRef<ScannerState>('idle');
  useEffect(() => {
    scannerStateRef.current = scannerState;
  }, [scannerState]);

  // Clean up media stream and timers on unmount
  useEffect(() => {
    return () => {
      stopCameraStream();
    };
  }, []);

  const stopCameraStream = () => {
    if (barcodeScanIntervalRef.current) {
      clearInterval(barcodeScanIntervalRef.current);
      barcodeScanIntervalRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => {
        track.stop();
      });
      mediaStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  // 1. CAMERA LIFECYCLE
  const startCamera = async () => {
    stopCameraStream();
    setCameraError(null);
    setGeneralError(null);
    setPreviewImage(null);
    setMatchedBook(null);
    setCandidates([]);
    setDetectedMetadata(null);
    setScannerMode('camera');
    setScannerState('camera-starting');

    // HTTPS / Secure context check for production browser camera access
    if (typeof window !== 'undefined' && !window.isSecureContext && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      const msg = 'Camera access requires a secure HTTPS connection. Please ensure BookNest is running over HTTPS, or upload a book photo below.';
      setCameraError(msg);
      setScannerState('camera-unavailable');
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const msg = 'Camera access is not supported by your current browser. Please upload an image instead.';
      setCameraError(msg);
      setScannerState('camera-unavailable');
      return;
    }

    try {
      // Prefer rear/environment camera on mobile, but gracefully fall back
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920, min: 640 },
          height: { ideal: 1080, min: 480 },
        },
        audio: false,
      };

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (constraintErr: any) {
        // Fall back gracefully if ideal constraints failed
        console.warn('Initial camera constraints failed, falling back to basic video constraint:', constraintErr);
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }

      mediaStreamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setScannerState('camera-ready');

        // Optional: Real-time Barcode Detection if supported
        initRealtimeBarcodeDetection();
      }
    } catch (err: any) {
      console.warn('Camera access error:', err);
      stopCameraStream();
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        const msg = 'Camera permission was denied. Please allow camera access in your browser settings, or use image upload below.';
        setCameraError(msg);
        setScannerState('camera-denied');
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError' || err.name === 'NotReadableError') {
        const msg = 'No camera hardware found or device is already in use. Please upload a book cover photo instead.';
        setCameraError(msg);
        setScannerState('camera-unavailable');
      } else {
        const msg = err.message || 'Unable to start camera preview. Please upload an image instead.';
        setCameraError(msg);
        setScannerState('error');
      }
    }
  };

  const stopCamera = () => {
    stopCameraStream();
    setScannerState('idle');
  };

  // Real-time Barcode Detector loop (Web standard BarcodeDetector API)
  // BUG 1 Fix: uses scannerStateRef.current, clears interval before starting
  const initRealtimeBarcodeDetection = () => {
    if (barcodeScanIntervalRef.current) {
      clearInterval(barcodeScanIntervalRef.current);
      barcodeScanIntervalRef.current = null;
    }

    if (!('BarcodeDetector' in window)) return;

    try {
      const barcodeDetector = new (window as any).BarcodeDetector({
        formats: ['ean_13', 'ean_8', 'upc_a', 'code_128', 'qr_code'],
      });

      barcodeScanIntervalRef.current = setInterval(async () => {
        if (
          videoRef.current && 
          videoRef.current.readyState >= 2 && 
          scannerStateRef.current === 'camera-ready'
        ) {
          try {
            const barcodes = await barcodeDetector.detect(videoRef.current);
            if (barcodes.length > 0 && barcodes[0].rawValue) {
              if (isScanningRef.current) return;
              const detectedCode = barcodes[0].rawValue;
              stopCameraStream();
              processDetectedBarcode(detectedCode, 'REAL CAMERA');
            }
          } catch {
            // Frame skip is normal during movement
          }
        }
      }, 750);
    } catch {
      // BarcodeDetector not supported or disabled
    }
  };

  // Freeze/Capture Camera Frame
  // BUG 7 Fix: actual videoWidth/Height, check readyState >= 2, no upscaling, high JPEG quality
  const captureFrame = () => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      setGeneralError('Camera video feed is still stabilizing. Please wait a moment before capturing.');
      return;
    }

    const width = video.videoWidth;
    const height = video.videoHeight;
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.95);

    stopCameraStream();
    setPreviewImage(dataUrl);
    setPreviewMimeType('image/jpeg');
    setScannerMode('camera');
    setScannerState('captured');
    setGeneralError(null);
  };

  // Retake photo / Resume camera
  const handleRetake = () => {
    setPreviewImage(null);
    setMatchedBook(null);
    setCandidates([]);
    setGeneralError(null);
    setDetectedMetadata(null);
    startCamera();
  };

  // 2. IMAGE UPLOAD LIFECYCLE
  // BUG 8 Fix: strict upload validation, feeds identical pipeline
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    stopCameraStream();
    setGeneralError(null);
    setCameraError(null);
    setMatchedBook(null);
    setCandidates([]);
    setDetectedMetadata(null);

    // Validate file type
    const validMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!validMimes.includes(file.type.toLowerCase())) {
      setGeneralError(`Unsupported image format (${file.type || 'unknown'}). Only JPG, JPEG, PNG, and WEBP files are supported.`);
      setScannerState('invalid-image');
      return;
    }

    // Validate file size (max 10MB)
    const maxBytes = 10 * 1024 * 1024;
    if (file.size > maxBytes) {
      setGeneralError('Image size exceeds 10MB limit. Please upload a compressed or standard photo.');
      setScannerState('invalid-image');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setPreviewImage(dataUrl);
      setPreviewMimeType(file.type || 'image/jpeg');
      setScannerMode('upload');
      setScannerState('captured');
    };

    reader.onerror = () => {
      setGeneralError('Failed to read image file from disk.');
      setScannerState('invalid-image');
    };

    reader.readAsDataURL(file);
  };

  // 3. EXECUTE RECOGNITION PIPELINE ON PREVIEW IMAGE
  // Implements full fallback order (BUG 2, BUG 3, BUG 4, BUG 8, BUG 9)
  const processImageRecognition = async () => {
    if (!previewImage || isScanningRef.current) return;
    isScanningRef.current = true;

    setScannerState('processing');
    setGeneralError(null);
    setMatchedBook(null);
    setCandidates([]);
    setDetectedMetadata(null);

    try {
      // Step A: Attempt client-side BarcodeDetector on image if supported
      let detectedBarcode: string | null = null;
      if ('BarcodeDetector' in window) {
        try {
          const img = new Image();
          img.src = previewImage;
          await img.decode();
          const barcodeDetector = new (window as any).BarcodeDetector({
            formats: ['ean_13', 'ean_8', 'upc_a', 'code_128', 'qr_code'],
          });
          const barcodes = await barcodeDetector.detect(img);
          if (barcodes.length > 0 && barcodes[0].rawValue) {
            detectedBarcode = barcodes[0].rawValue;
          }
        } catch {
          // Fallback to OCR pipeline
        }
      }

      if (detectedBarcode) {
        isScanningRef.current = false;
        await processDetectedBarcode(detectedBarcode, scannerMode === 'camera' ? 'REAL CAMERA' : 'REAL IMAGE UPLOAD');
        return;
      }

      // Step B: Send to Backend OCR & Deterministic Matching Pipeline
      setScannerState('ocr-processing');
      try {
        const res = await api.scanVision(previewImage, previewMimeType);

        setDetectedMetadata(res.detectedMetadata || null);

        // Handle Gemini configuration error (BUG 4)
        if (res.matchType === 'VISION_CONFIGURATION_ERROR') {
          setGeneralError(res.error || 'Gemini Vision is not configured on the backend.');
          setScannerState('vision-unconfigured');
          return;
        }

        // Handle no book in image (BUG 9 State 5)
        if (res.matchType === 'NO_BOOK_DETECTED') {
          setGeneralError(res.error || 'The image does not appear to contain a book cover or barcode.');
          setScannerState('no-book-detected');
          return;
        }

        // Handle blurry / unclear text (BUG 9 State 4)
        if (res.matchType === 'TEXT_UNCLEAR') {
          setGeneralError(res.error || 'Book cover detected, but printed text is too blurry to read.');
          setScannerState('text-unclear');
          return;
        }

        // Handle single confident match (Local or External)
        if (res.matched && res.book) {
          setMatchedBook(res.book);
          setMatchType(res.matchType);
          setCalculatedConfidence(res.confidence);
          setMatchEvidence(res.evidence || '');
          setCandidates(res.candidates || []);
          if (res.isLocalCatalog === false || res.book.stock === 0) {
            setScannerState('not-stocked');
          } else {
            setScannerState('matched');
          }
        } else if (res.candidates && res.candidates.length > 0) {
          setCandidates(res.candidates);
          setCalculatedConfidence(res.confidence);
          setMatchEvidence(res.evidence || '');
          setScannerState('multiple-matches');
        } else {
          setGeneralError(res.error || 'No catalog titles or external records matched the extracted text.');
          setScannerState('no-match');
        }
      } catch (err: any) {
        setGeneralError(err.message || 'Optical machine vision analysis failed.');
        setScannerState('error');
      }
    } finally {
      isScanningRef.current = false;
    }
  };

  // Process detected barcode string
  const processDetectedBarcode = async (rawCode: string, source: 'REAL CAMERA' | 'REAL IMAGE UPLOAD') => {
    if (isScanningRef.current) return;
    isScanningRef.current = true;

    setScannerState('isbn-detected');
    setGeneralError(null);

    const cleanIsbn = rawCode.replace(/[^0-9X]/gi, '');

    try {
      setScannerState('searching');
      const res = await api.scanIsbn(cleanIsbn);

      if (res.matched && res.book) {
        setMatchedBook(res.book);
        setMatchType(res.matchType || 'ISBN_EXACT');
        setCalculatedConfidence(res.confidence || 1.0);
        setMatchEvidence(`Detected via ${source} barcode scan: ${res.evidence}`);
        setCandidates(res.candidates || []);
        if (res.isLocalCatalog === false || res.book.stock === 0) {
          setScannerState('not-stocked');
        } else {
          setScannerState('matched');
        }
      } else {
        setGeneralError(res.error || `No book found in catalog for barcode: ${rawCode}`);
        setScannerState('no-match');
      }
    } catch (err: any) {
      setGeneralError(err.message || `No book found in catalog for barcode: ${rawCode}`);
      setScannerState('no-match');
    } finally {
      isScanningRef.current = false;
    }
  };

  // 4. MANUAL ISBN / TITLE SEARCH
  const executeSearch = async (queryToSearch: string) => {
    const rawClean = queryToSearch.trim();
    if (!rawClean) return;

    stopCameraStream();
    setScannerMode('manual');
    setScannerState('searching');
    setGeneralError(null);
    setMatchedBook(null);
    setCandidates([]);
    setDetectedMetadata(null);

    // Normalize ISBN prefix if present (e.g. "ISBN 978-0-13-235088-4" -> "978-0-13-235088-4")
    const clean = rawClean.replace(/^(?:ISBN(?:-1[03])?:?\s*)/i, '').trim();
    const isDigits = /^[0-9X-]+$/i.test(clean);

    try {
      if (isDigits) {
        const res = await api.scanIsbn(clean);
        if (res.matched && res.book) {
          setMatchedBook(res.book);
          setMatchType(res.matchType);
          setCalculatedConfidence(res.confidence);
          setMatchEvidence(res.evidence);
          setCandidates(res.candidates || []);
          if (res.isLocalCatalog === false || res.book.stock === 0) {
            setScannerState('not-stocked');
          } else {
            setScannerState('matched');
          }
        } else {
          setGeneralError(res.error || `No catalog records found for ISBN "${clean}".`);
          setScannerState('no-match');
        }
      } else {
        const res = await api.matchText(rawClean);
        if (res.matched && res.book) {
          setMatchedBook(res.book);
          setMatchType(res.matchType);
          setCalculatedConfidence(res.confidence);
          setMatchEvidence(res.evidence);
          setCandidates(res.candidates || []);
          if (res.book.stock === 0 || res.book.isLocalCatalog === false) {
            setScannerState('not-stocked');
          } else {
            setScannerState('matched');
          }
        } else if (res.candidates && res.candidates.length > 0) {
          setCandidates(res.candidates);
          setCalculatedConfidence(res.confidence);
          setMatchEvidence(res.evidence);
          setScannerState('multiple-matches');
        } else {
          setGeneralError(res.error || `No titles matching "${rawClean}" found.`);
          setScannerState('no-match');
        }
      }
    } catch (err: any) {
      setGeneralError(err.message || `Search failed for "${rawClean}".`);
      setScannerState('no-match');
    }
  };

  const handleManualSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    await executeSearch(manualQuery);
  };

  // 5. DEMO SAMPLE MODE (Explicitly labelled DEMO)
  const handleSelectDemoSample = (book: Book) => {
    stopCameraStream();
    setPreviewImage(book.coverImage);
    setScannerMode('demo');
    setMatchedBook(book);
    setMatchType('DEMO_SAMPLE');
    setCalculatedConfidence(1.0);
    setMatchEvidence(`Preloaded campus demonstration sample (${book.title}). This sample does not invoke hardware vision.`);
    setCandidates([]);
    setDetectedMetadata(null);
    setGeneralError(null);
    setScannerState('matched');
  };

  // Reset to initial ready state
  const handleResetScanner = () => {
    stopCameraStream();
    setScannerState('idle');
    setMatchedBook(null);
    setCandidates([]);
    setPreviewImage(null);
    setGeneralError(null);
    setCameraError(null);
    setDetectedMetadata(null);
  };

  // Reusable Optical Readout Diagnostic Card (BUG 9)
  const renderDetectedMetadata = () => {
    if (!detectedMetadata) return null;
    const hasFields = Boolean(
      detectedMetadata.title ||
      detectedMetadata.author ||
      detectedMetadata.isbn ||
      detectedMetadata.publisher ||
      (detectedMetadata.rawTextLines && detectedMetadata.rawTextLines.length > 0)
    );
    if (!hasFields) return null;

    return (
      <div className="mt-4 p-3.5 rounded-2xl bg-slate-900 text-slate-100 text-left text-xs font-mono border border-slate-800 shadow-inner space-y-1">
        <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-slate-800">
          <span className="font-bold text-amber-400 uppercase text-[10px] tracking-wider flex items-center gap-1.5">
            <i className="fa-solid fa-microchip"></i>
            <span>Optical Vision Readout</span>
          </span>
          <span className="text-[10px] text-slate-400">Scanner Diagnostics</span>
        </div>
        {detectedMetadata.title && (
          <div><span className="text-slate-400">Detected title:</span> <span className="text-amber-200 font-semibold">{detectedMetadata.title}</span></div>
        )}
        {detectedMetadata.author && (
          <div><span className="text-slate-400">Detected author:</span> <span className="text-slate-200 font-semibold">{detectedMetadata.author}</span></div>
        )}
        {detectedMetadata.isbn && (
          <div><span className="text-slate-400">Detected ISBN:</span> <span className="text-emerald-400 font-semibold">{detectedMetadata.isbn}</span></div>
        )}
        {detectedMetadata.publisher && (
          <div><span className="text-slate-400">Detected publisher:</span> <span className="text-slate-200">{detectedMetadata.publisher}</span></div>
        )}
        {detectedMetadata.notes && (
          <div><span className="text-slate-400">Extraction notes:</span> <span className="text-slate-300 italic">{detectedMetadata.notes}</span></div>
        )}
      </div>
    );
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 font-sans">
      
      {/* Hidden processing canvas */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Editorial Header */}
      <div className="max-w-3xl mx-auto text-center mb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-100 text-amber-900 text-xs font-semibold mb-3">
          <i className="fa-solid fa-barcode text-amber-700"></i>
          <span>DETERMINISTIC OPTICAL COVER &amp; ISBN SCANNER</span>
        </div>
        <h1 className="font-serif font-black text-3xl sm:text-4xl text-slate-950 tracking-tight">
          Point, Scan, and Learn Instantly
        </h1>
        <p className="text-xs sm:text-sm text-slate-600 mt-2 font-sans max-w-xl mx-auto leading-relaxed">
          Scan ISBN barcodes using real device camera video frames, upload textbook covers for optical OCR matching, or search the BookNest warehouse directly.
        </p>

        {/* Mode Indicators */}
        <div className="flex items-center justify-center gap-2 mt-4 text-[11px] font-mono">
          <span className="text-slate-400">Active Pipeline Mode:</span>
          <span className={`px-2 py-0.5 rounded font-bold uppercase tracking-wider ${
            scannerMode === 'camera' 
              ? 'bg-blue-100 text-blue-900 border border-blue-200' 
              : scannerMode === 'upload'
              ? 'bg-purple-100 text-purple-900 border border-purple-200'
              : scannerMode === 'demo'
              ? 'bg-amber-100 text-amber-900 border border-amber-300'
              : 'bg-slate-100 text-slate-800'
          }`}>
            {scannerMode === 'camera' && '● Real Camera Mode'}
            {scannerMode === 'upload' && '● Real Image Upload'}
            {scannerMode === 'demo' && '★ Try Scanner Demo'}
            {scannerMode === 'manual' && '⌨ Manual Search'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* Left Column: Viewfinder & Controls Frame */}
        <div className="lg:col-span-7 bg-white rounded-3xl border border-slate-200/90 p-6 sm:p-8 shadow-xl">
          
          {/* Non-blocking informational banner if Gemini Vision OCR is not configured */}
          {isVisionConfigured === false && (
            <div className="mb-4 p-3.5 rounded-2xl bg-amber-50/90 border border-amber-200 text-xs text-amber-950 flex items-start gap-2.5 animate-in fade-in duration-200">
              <i className="fa-solid fa-circle-info text-amber-600 mt-0.5 text-sm shrink-0"></i>
              <div className="flex-1 leading-relaxed">
                <span className="font-bold text-amber-900">AI Cover Recognition Offline:</span>{' '}
                <span className="text-amber-800">
                  Optical cover OCR requires <code className="px-1 py-0.5 bg-amber-100/80 rounded font-mono text-[11px] text-amber-900">GEMINI_API_KEY</code> on Render. For camera scanning, point your camera at the <strong>ISBN barcode on the back cover</strong>, or use the <strong>manual search bar</strong> below.
                </span>
              </div>
            </div>
          )}

          {/* Top HUD Controls */}
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-3 border-b border-slate-100 text-xs">
            
            {/* Status indicator badge */}
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${
                scannerState === 'camera-ready' ? 'bg-emerald-500 animate-pulse' :
                scannerState === 'processing' || scannerState === 'ocr-processing' || scannerState === 'searching' ? 'bg-amber-500 animate-ping' :
                scannerState === 'matched' ? 'bg-emerald-600' :
                scannerState === 'not-stocked' ? 'bg-blue-600' :
                scannerState === 'error' || scannerState === 'no-match' || scannerState === 'vision-unconfigured' || scannerState === 'camera-denied' ? 'bg-rose-500' :
                'bg-slate-400'
              }`}></span>
              <span className="font-mono text-[11px] text-slate-800 font-bold uppercase">
                {scannerState === 'idle' && 'Scanner Idle'}
                {scannerState === 'camera-starting' && 'Starting Camera...'}
                {scannerState === 'camera-ready' && 'Live Camera Active'}
                {scannerState === 'captured' && 'Frame Captured (Review)'}
                {scannerState === 'processing' && 'Analyzing Barcode...'}
                {scannerState === 'ocr-processing' && 'Running Vision OCR...'}
                {scannerState === 'searching' && 'Querying Catalog...'}
                {scannerState === 'matched' && 'Book Found (In Stock)'}
                {scannerState === 'not-stocked' && 'Book Identified (Not Stocked)'}
                {scannerState === 'multiple-matches' && 'Possible Matches'}
                {scannerState === 'text-unclear' && 'Text Unclear'}
                {scannerState === 'no-book-detected' && 'No Book Detected'}
                {scannerState === 'vision-unconfigured' && 'Vision Not Configured'}
                {scannerState === 'camera-denied' && 'Camera Permission Denied'}
                {scannerState === 'camera-unavailable' && 'Camera Unavailable'}
                {scannerState === 'invalid-image' && 'Invalid Image'}
                {scannerState === 'no-match' && 'No Match Found'}
                {scannerState === 'error' && 'Scanner Exception'}
              </span>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2">
              {scannerState === 'camera-ready' ? (
                <>
                  <button
                    type="button"
                    onClick={captureFrame}
                    className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-sm transition-all"
                  >
                    <i className="fa-solid fa-camera text-xs"></i>
                    <span>Capture Frame</span>
                  </button>
                  <button
                    type="button"
                    onClick={stopCamera}
                    className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs transition-colors"
                  >
                    Stop
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={startCamera}
                  className="px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs flex items-center gap-1.5 transition-colors"
                >
                  <i className="fa-solid fa-video text-xs"></i>
                  <span>Start Camera</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-3 py-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-900 font-semibold text-xs border border-amber-200 flex items-center gap-1.5 transition-colors"
              >
                <i className="fa-solid fa-cloud-arrow-up text-amber-700 text-xs"></i>
                <span>Upload Photo</span>
              </button>

              <input
                ref={fileInputRef}
                type="file"
                accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                onChange={handleFileSelect}
                className="hidden"
              />
            </div>
          </div>

          {/* Camera Error Alert */}
          {cameraError && (
            <div className="mb-4 p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-start gap-3 animate-in fade-in duration-150">
              <i className="fa-solid fa-circle-exclamation text-rose-600 text-base mt-0.5 shrink-0"></i>
              <div className="flex-1">
                <div className="font-bold">Camera Initialization Issue</div>
                <div className="mt-0.5 leading-relaxed">{cameraError}</div>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-2.5 py-1 rounded-lg bg-rose-900 text-white font-semibold text-[11px]"
                  >
                    Upload Cover Photo Instead
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Viewfinder / Video Canvas Viewport */}
          <div className="relative aspect-[4/3] rounded-2xl bg-slate-950 overflow-hidden flex items-center justify-center border-2 border-slate-800 shadow-inner group">
            
            {/* Live Video Preview */}
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className={`w-full h-full object-cover transition-opacity duration-200 ${
                scannerState === 'camera-ready' ? 'opacity-100' : 'opacity-0 pointer-events-none absolute inset-0'
              }`}
            />

            {/* Captured / Uploaded Image Preview */}
            {previewImage && scannerState !== 'camera-ready' && (
              <img
                src={previewImage}
                alt="Captured Textbook"
                className="w-full h-full object-contain bg-slate-900"
              />
            )}

            {/* Offline Viewfinder State (When idle & no preview) */}
            {!previewImage && scannerState !== 'camera-ready' && scannerState !== 'camera-starting' && (
              <div className="text-center p-6 text-slate-400 max-w-sm">
                <div className="w-16 h-16 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center mx-auto mb-3 text-2xl text-amber-400 shadow-inner">
                  <i className="fa-solid fa-camera-rotate"></i>
                </div>
                <h4 className="font-serif font-bold text-base text-slate-200">
                  Optical Viewfinder Ready
                </h4>
                <p className="text-xs text-slate-400 mt-1">
                  Start your device camera to scan a physical barcode, or upload a cover photo to run machine vision.
                </p>
                <div className="mt-4 flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={startCamera}
                    className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow-md transition-all flex items-center gap-1.5"
                  >
                    <i className="fa-solid fa-camera"></i>
                    <span>Start Live Camera</span>
                  </button>
                </div>
              </div>
            )}

            {/* Camera Starting Spinner */}
            {scannerState === 'camera-starting' && (
              <div className="text-center p-6 text-white">
                <i className="fa-solid fa-circle-notch fa-spin text-3xl text-amber-400 mb-2"></i>
                <p className="text-xs font-mono text-slate-300">Requesting camera device...</p>
              </div>
            )}

            {/* Laser reticle overlay (Visible during camera preview) */}
            {scannerState === 'camera-ready' && (
              <div className="absolute inset-8 border border-amber-500/40 rounded-xl pointer-events-none flex flex-col justify-between p-3">
                <div className="flex justify-between">
                  <div className="w-4 h-4 border-t-2 border-l-2 border-amber-400"></div>
                  <div className="w-4 h-4 border-t-2 border-r-2 border-amber-400"></div>
                </div>
                <div className="flex justify-between">
                  <div className="w-4 h-4 border-b-2 border-l-2 border-amber-400"></div>
                  <div className="w-4 h-4 border-b-2 border-r-2 border-amber-400"></div>
                </div>
                <div className="absolute inset-x-8 h-0.5 bg-gradient-to-r from-transparent via-amber-400 to-transparent shadow-[0_0_12px_#fbbf24] animate-scan-line"></div>
              </div>
            )}

            {/* Processing HUD Overlay */}
            {(scannerState === 'processing' || scannerState === 'ocr-processing' || scannerState === 'searching') && (
              <div className="absolute inset-0 bg-slate-950/75 backdrop-blur-xs flex flex-col items-center justify-center text-white p-6">
                <i className="fa-solid fa-compact-disc fa-spin text-4xl text-amber-400 mb-3"></i>
                <div className="font-serif font-bold text-base">Running Optical Recognition</div>
                <p className="text-xs text-slate-300 font-mono mt-1 text-center max-w-xs">
                  {scannerState === 'ocr-processing' ? 'Extracting text and barcode vectors...' : 'Cross-referencing BookNest database...'}
                </p>
              </div>
            )}

          </div>

          {/* Prominent Viewfinder Action Controls when Camera is Active */}
          {scannerState === 'camera-ready' && (
            <div className="mt-4 flex items-center justify-center gap-3 animate-in fade-in duration-200">
              <button
                type="button"
                onClick={captureFrame}
                className="px-6 py-3 rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm shadow-lg hover:shadow-xl transition-all flex items-center gap-2 transform active:scale-95"
              >
                <i className="fa-solid fa-camera text-base"></i>
                <span>Capture Frame & Scan Book</span>
              </button>
              <button
                type="button"
                onClick={stopCamera}
                className="px-4 py-3 rounded-2xl bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold text-xs transition-colors"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Captured Preview Action Bar ("Use This Image" vs "Retake") */}
          {scannerState === 'captured' && previewImage && (
            <div className="mt-4 p-4 rounded-2xl bg-amber-50/80 border border-amber-200 flex flex-col sm:flex-row items-center justify-between gap-3 animate-in fade-in duration-200">
              <div className="text-xs text-amber-950 font-medium">
                <span className="font-bold">Image Ready:</span> Review your photo above before scanning.
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={handleRetake}
                  className="flex-1 sm:flex-none px-4 py-2 rounded-xl bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5"
                >
                  <i className="fa-solid fa-rotate-left text-xs"></i>
                  <span>Retake</span>
                </button>
                <button
                  type="button"
                  onClick={processImageRecognition}
                  className="flex-1 sm:flex-none px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-bold shadow-md transition-all flex items-center justify-center gap-1.5"
                >
                  <i className="fa-solid fa-wand-magic-sparkles text-xs"></i>
                  <span>Use This Image</span>
                </button>
              </div>
            </div>
          )}

          {/* Status HUD readout bar */}
          <div className="mt-4 p-3.5 rounded-2xl bg-slate-50 border border-slate-200/90 text-xs font-mono flex items-center justify-between text-slate-700">
            <div className="flex items-center gap-2 truncate">
              <i className="fa-solid fa-terminal text-amber-600 text-xs shrink-0"></i>
              <span className="truncate">
                {scannerState === 'idle' && 'Ready. Start camera, upload photo, or enter ISBN.'}
                {scannerState === 'camera-starting' && 'Initializing MediaDevices video stream...'}
                {scannerState === 'camera-ready' && 'Align textbook cover or barcode in laser reticle.'}
                {scannerState === 'captured' && 'Frame held. Click "Use This Image" to begin match.'}
                {scannerState === 'processing' && 'Checking hardware barcode detector...'}
                {scannerState === 'ocr-processing' && 'Extracting title, author, and publisher...'}
                {scannerState === 'searching' && 'Ranking candidates against local database...'}
                {scannerState === 'matched' && (matchEvidence || 'Book successfully identified in campus stock.')}
                {scannerState === 'not-stocked' && (matchEvidence || 'Book identified via global archives (not stocked locally).')}
                {scannerState === 'multiple-matches' && 'Multiple possible matches found. Select one.'}
                {scannerState === 'text-unclear' && 'Book cover detected, but printed text is blurry.'}
                {scannerState === 'no-book-detected' && 'No book cover or barcode detected in image.'}
                {scannerState === 'vision-unconfigured' && 'Gemini Vision API is not configured on server.'}
                {scannerState === 'camera-denied' && 'Camera permission was denied in browser.'}
                {scannerState === 'camera-unavailable' && 'Camera hardware not available on device.'}
                {scannerState === 'invalid-image' && (generalError || 'Invalid image uploaded.')}
                {scannerState === 'no-match' && 'No catalog titles met similarity threshold.'}
                {scannerState === 'error' && (generalError || 'Scanner halted due to error.')}
              </span>
            </div>

            {calculatedConfidence !== null && (scannerState === 'matched' || scannerState === 'not-stocked') && (
              <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold shrink-0">
                {Math.round(calculatedConfidence * 100)}% Calculated Match
              </span>
            )}
          </div>

          {/* General Error Banner */}
          {generalError && scannerState !== 'matched' && scannerState !== 'not-stocked' && (
            <div className="mt-3 p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
              <i className="fa-solid fa-circle-exclamation text-rose-600 shrink-0"></i>
              <span>{generalError}</span>
            </div>
          )}

          {/* Manual ISBN / Title Search Input */}
          <div className="mt-6 pt-5 border-t border-slate-100">
            <form onSubmit={handleManualSearch} className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={manualQuery}
                  onChange={(e) => setManualQuery(e.target.value)}
                  placeholder="Or enter ISBN (e.g. 9780132350884) or title manually..."
                  className="w-full py-2.5 pl-8 pr-3 rounded-xl bg-slate-50 border border-slate-200 text-xs focus:ring-2 focus:ring-amber-500 focus:bg-white focus:outline-none"
                />
                <i className="fa-solid fa-magnifying-glass absolute left-3 top-3 text-slate-400 text-xs"></i>
              </div>
              <button
                type="submit"
                className="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-amber-600 text-white font-bold text-xs transition-colors shrink-0"
              >
                Lookup ISBN
              </button>
            </form>
          </div>

          {/* Try Scanner Demo Section (Explicitly Labelled DEMO) */}
          <div className="mt-5 pt-4 border-t border-slate-100">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <i className="fa-solid fa-flask text-amber-600"></i>
                <span>Try Scanner Demo (Preset Samples)</span>
              </span>
              <span className="px-1.5 py-0.2 rounded bg-amber-100 text-amber-900 text-[10px] font-bold font-mono">
                DEMO MODE
              </span>
            </div>
            <p className="text-[11px] text-slate-500 mb-2.5">
              Select a catalog sample to preview the recognized result card. Samples are explicitly labelled DEMO.
            </p>
            <div className="flex flex-wrap gap-2">
              {displaySamples.map(sample => (
                <button
                  key={sample.id}
                  type="button"
                  data-testid="demo-sample-btn"
                  onClick={() => handleSelectDemoSample(sample)}
                  className="px-2.5 py-1.5 rounded-xl bg-slate-50 hover:bg-amber-50 hover:border-amber-300 text-slate-800 text-xs border border-slate-200 flex items-center gap-1.5 transition-colors"
                >
                  <span className="px-1 py-0.2 rounded bg-amber-200 text-amber-900 text-[9px] font-bold">DEMO</span>
                  <span className="font-medium truncate max-w-[140px]">{sample.title}</span>
                </button>
              ))}
            </div>
          </div>

        </div>

        {/* Right Column: Dynamic Results Frame */}
        <div className="lg:col-span-5 space-y-4">
          
          {/* ================= STATE 1: BOOK FOUND (IN LOCAL STOCK) ================= */}
          {scannerState === 'matched' && matchedBook && (
            <div className="bg-white rounded-3xl border border-slate-200/90 p-6 shadow-xl space-y-5 animate-in fade-in zoom-in-95 duration-200">
              
              {/* Header Badge */}
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                    matchType === 'DEMO_SAMPLE'
                      ? 'bg-amber-100 text-amber-900 border border-amber-300'
                      : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                  }`}>
                    <i className={`fa-solid ${matchType === 'DEMO_SAMPLE' ? 'fa-flask' : 'fa-check'} text-[10px]`}></i>
                    <span>{matchType === 'DEMO_SAMPLE' ? 'DEMO SAMPLE' : 'BOOK FOUND'}</span>
                  </span>
                  {calculatedConfidence !== null && (
                    <span className="font-mono text-[10px] text-slate-500">
                      ({Math.round(calculatedConfidence * 100)}% Confidence)
                    </span>
                  )}
                </div>
                <span className="text-xs font-mono text-slate-400">
                  ISBN: {matchedBook.isbn}
                </span>
              </div>

              {/* Evidence Callout */}
              {matchEvidence && (
                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-600 flex items-start gap-2">
                  <i className="fa-solid fa-magnifying-glass text-amber-600 text-xs mt-0.5 shrink-0"></i>
                  <span className="leading-snug">{matchEvidence}</span>
                </div>
              )}

              {/* Book Details */}
              <div className="flex gap-4">
                <img
                  src={matchedBook.coverImage || 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=600&auto=format&fit=crop&q=80'}
                  alt={matchedBook.title}
                  className="w-24 h-36 object-cover rounded-xl shadow-md book-spine shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <span className="text-[10px] font-bold text-amber-700 uppercase tracking-widest block">
                    {matchedBook.category}
                  </span>
                  <h3 className="font-serif font-bold text-lg text-slate-950 leading-snug line-clamp-2 mt-0.5">
                    {matchedBook.title}
                  </h3>
                  <p className="text-xs text-slate-600 mt-1">by {matchedBook.author}</p>
                  
                  <div className="flex items-center gap-2 mt-2 text-xs">
                    <span className="text-amber-500 font-bold flex items-center gap-1">
                      <i className="fa-solid fa-star text-[10px]"></i>
                      {matchedBook.rating}
                    </span>
                    <span className="text-slate-300">·</span>
                    <span className="text-slate-500">{matchedBook.pages} pages</span>
                    {matchedBook.publisher && (
                      <>
                        <span className="text-slate-300">·</span>
                        <span className="text-slate-500 truncate">{matchedBook.publisher}</span>
                      </>
                    )}
                  </div>

                  <div className="mt-3 flex items-baseline gap-2">
                    <span className="font-serif font-bold text-xl text-slate-900">
                      ₹{Math.round(matchedBook.price * (1 - matchedBook.discount / 100))}
                    </span>
                    {matchedBook.discount > 0 && (
                      <span className="text-xs text-slate-400 line-through">₹{matchedBook.price}</span>
                    )}
                  </div>
                </div>
              </div>

              <p className="text-xs text-slate-600 line-clamp-3 leading-relaxed">
                {matchedBook.description}
              </p>

              {/* Action Buttons */}
              <div className="pt-4 border-t border-slate-100 flex flex-col gap-2">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => onAddToCart(matchedBook, 1)}
                    disabled={matchedBook.stock <= 0}
                    className="flex-1 py-3 rounded-xl bg-slate-900 hover:bg-amber-600 text-amber-50 hover:text-slate-950 font-bold text-xs shadow-md transition-all flex items-center justify-center gap-2"
                  >
                    <i className="fa-solid fa-bag-shopping"></i>
                    <span>Add to Bag (Stock: {matchedBook.stock})</span>
                  </button>
                  <button
                    onClick={() => onQuickView(matchedBook)}
                    className="px-4 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs transition-colors"
                  >
                    Details
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  {onToggleWishlist && (
                    <button
                      onClick={() => onToggleWishlist(matchedBook.id, matchedBook.title)}
                      className="flex-1 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-900 font-medium text-xs border border-amber-200 flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <i className="fa-regular fa-heart text-amber-700"></i>
                      <span>Add to Wishlist</span>
                    </button>
                  )}
                  <button
                    onClick={handleResetScanner}
                    className="flex-1 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-medium transition-colors"
                  >
                    Scan Another Book
                  </button>
                </div>
              </div>

              {renderDetectedMetadata()}

            </div>
          )}

          {/* ================= STATE 2: BOOK IDENTIFIED — NOT IN LOCAL STOCK ================= */}
          {scannerState === 'not-stocked' && matchedBook && (
            <div className="bg-white rounded-3xl border border-blue-200 p-6 shadow-xl space-y-5 animate-in fade-in zoom-in-95 duration-200">
              
              {/* Header Badge */}
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-100 text-blue-900 border border-blue-300">
                  <i className="fa-solid fa-globe text-[10px]"></i>
                  <span>BOOK IDENTIFIED — NOT IN LOCAL STOCK</span>
                </span>
                <span className="text-xs font-mono text-slate-400">
                  ISBN: {matchedBook.isbn || 'N/A'}
                </span>
              </div>

              {/* Informational Notice */}
              <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-xs text-blue-900 leading-relaxed">
                <span className="font-bold">External Library Match:</span> This book was verified via OpenLibrary / external records, but is currently not stocked in the BookNest campus warehouse.
              </div>

              {/* Book Details (Genuine Metadata without fabricated prices) */}
              <div className="flex gap-4">
                {matchedBook.coverImage ? (
                  <img
                    src={matchedBook.coverImage}
                    alt={matchedBook.title}
                    className="w-24 h-36 object-cover rounded-xl shadow-md book-spine shrink-0"
                  />
                ) : (
                  <div className="w-24 h-36 rounded-xl bg-slate-100 border border-slate-200 flex flex-col items-center justify-center text-slate-400 text-center p-2 shrink-0">
                    <i className="fa-solid fa-book text-2xl mb-1"></i>
                    <span className="text-[10px] leading-tight">No Cover Available</span>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <span className="text-[10px] font-bold text-blue-700 uppercase tracking-widest block">
                    {matchedBook.category || 'Academic Publication'}
                  </span>
                  <h3 className="font-serif font-bold text-lg text-slate-950 leading-snug line-clamp-2 mt-0.5">
                    {matchedBook.title}
                  </h3>
                  <p className="text-xs text-slate-600 mt-1">by {matchedBook.author}</p>
                  
                  <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-slate-500">
                    {matchedBook.pages > 0 && <span>{matchedBook.pages} pages</span>}
                    {matchedBook.publisher && (
                      <>
                        <span className="text-slate-300">·</span>
                        <span className="truncate">{matchedBook.publisher}</span>
                      </>
                    )}
                    {matchedBook.year > 0 && (
                      <>
                        <span className="text-slate-300">·</span>
                        <span>{matchedBook.year}</span>
                      </>
                    )}
                  </div>

                  <div className="mt-3">
                    <span className="inline-block px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-xs font-semibold">
                      Campus Warehouse Stock: 0
                    </span>
                  </div>
                </div>
              </div>

              <p className="text-xs text-slate-600 line-clamp-3 leading-relaxed">
                {matchedBook.description}
              </p>

              {/* Action Buttons */}
              <div className="pt-4 border-t border-slate-100 flex flex-col gap-2">
                <button
                  disabled
                  className="w-full py-3 rounded-xl bg-slate-200 text-slate-500 font-bold text-xs cursor-not-allowed flex items-center justify-center gap-2"
                >
                  <i className="fa-solid fa-box-archive"></i>
                  <span>Not in Local Stock (Special Order Only)</span>
                </button>
                <button
                  onClick={handleResetScanner}
                  className="w-full py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-colors"
                >
                  Scan Another Book
                </button>
              </div>

              {renderDetectedMetadata()}

            </div>
          )}

          {/* ================= STATE 3: POSSIBLE MATCHES ================= */}
          {scannerState === 'multiple-matches' && candidates.length > 0 && (
            <div className="bg-white rounded-3xl border border-slate-200/90 p-6 shadow-xl space-y-4 animate-in fade-in zoom-in-95 duration-200">
              
              <div className="pb-3 border-b border-slate-100">
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[11px] font-bold">
                  <i className="fa-solid fa-list-check text-amber-700"></i>
                  POSSIBLE MATCHES ({candidates.length} Found)
                </span>
                <p className="text-xs text-slate-500 mt-1.5">
                  We found multiple catalog titles matching the extracted text. Please select the correct book:
                </p>
              </div>

              <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                {candidates.map((cand, idx) => (
                  <div
                    key={cand.book.id || idx}
                    className="p-3.5 rounded-2xl border border-slate-200 hover:border-amber-400 bg-slate-50 hover:bg-amber-50/50 transition-all flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <img
                        src={cand.book.coverImage || 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=600&auto=format&fit=crop&q=80'}
                        alt={cand.book.title}
                        className="w-10 h-14 object-cover rounded shadow-xs shrink-0"
                      />
                      <div className="min-w-0">
                        <div className="font-serif font-bold text-xs text-slate-900 line-clamp-1">
                          {cand.book.title}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate">by {cand.book.author}</div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-200 text-slate-700">
                            {Math.round(cand.confidence * 100)}% match
                          </span>
                          {cand.book.price > 0 && (
                            <span className="font-bold text-xs text-slate-900">
                              ₹{Math.round(cand.book.price * (1 - cand.book.discount / 100))}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => {
                        setMatchedBook(cand.book);
                        setMatchType(cand.matchType);
                        setCalculatedConfidence(cand.confidence);
                        setMatchEvidence(cand.evidence);
                        if (cand.book.stock === 0 || cand.book.isLocalCatalog === false) {
                          setScannerState('not-stocked');
                        } else {
                          setScannerState('matched');
                        }
                      }}
                      className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-amber-600 text-white font-bold text-xs shrink-0 transition-colors"
                    >
                      Select
                    </button>
                  </div>
                ))}
              </div>

              <div className="pt-2">
                <button
                  onClick={handleResetScanner}
                  className="w-full py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-colors"
                >
                  None of these? Scan Again
                </button>
              </div>

              {renderDetectedMetadata()}

            </div>
          )}

          {/* ================= STATE 4: BOOK COVER DETECTED — TEXT UNCLEAR ================= */}
          {scannerState === 'text-unclear' && (
            <div className="bg-white rounded-3xl border border-amber-200 p-8 shadow-xl text-center space-y-4 animate-in fade-in duration-200">
              <div className="w-16 h-16 rounded-full bg-amber-50 border border-amber-300 flex items-center justify-center mx-auto text-2xl text-amber-600 shadow-sm">
                <i className="fa-solid fa-triangle-exclamation"></i>
              </div>
              <div>
                <span className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 text-xs font-bold font-mono">
                  BOOK COVER DETECTED — TEXT UNCLEAR
                </span>
                <h3 className="font-serif font-bold text-lg text-slate-900 mt-2">
                  Unreadable Cover Text
                </h3>
                <p className="text-xs text-slate-600 mt-1 max-w-sm mx-auto leading-relaxed">
                  A book or textbook was detected, but printed title and barcode text could not be resolved cleanly due to lighting, glare, or motion blur.
                </p>
              </div>

              <div className="p-3 rounded-2xl bg-amber-50/70 border border-amber-200 text-left text-xs text-amber-900 space-y-1">
                <div className="font-bold">Tips for better recognition:</div>
                <div className="text-[11px] text-amber-800">
                  • Avoid reflections or harsh shadows on glossy textbook covers.<br />
                  • Hold the device parallel to the cover for crisp text resolution.
                </div>
              </div>

              <div className="pt-2 flex flex-col gap-2">
                <button
                  onClick={handleRetake}
                  className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs shadow-sm transition-all"
                >
                  Try Again with Better Lighting
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs transition-colors"
                >
                  Upload Clearer Photo
                </button>
              </div>

              {renderDetectedMetadata()}
            </div>
          )}

          {/* ================= STATE 5: NO BOOK DETECTED ================= */}
          {scannerState === 'no-book-detected' && (
            <div className="bg-white rounded-3xl border border-slate-200/90 p-8 shadow-xl text-center space-y-4 animate-in fade-in duration-200">
              <div className="w-16 h-16 rounded-full bg-slate-100 border border-slate-300 flex items-center justify-center mx-auto text-2xl text-slate-500 shadow-sm">
                <i className="fa-solid fa-camera-slash"></i>
              </div>
              <div>
                <span className="px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-800 text-xs font-bold font-mono">
                  NO BOOK DETECTED
                </span>
                <h3 className="font-serif font-bold text-lg text-slate-900 mt-2">
                  Object is Not a Book
                </h3>
                <p className="text-xs text-slate-600 mt-1 max-w-sm mx-auto leading-relaxed">
                  The machine vision engine did not detect any book cover, textbook spine, or barcode in this image. Please center the book cover in the frame.
                </p>
              </div>

              <div className="pt-2 flex flex-col gap-2">
                <button
                  onClick={handleRetake}
                  className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs shadow-sm transition-all"
                >
                  Retake Photo
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs transition-colors"
                >
                  Upload Book Photo
                </button>
              </div>

              {renderDetectedMetadata()}
            </div>
          )}

          {/* ================= STATE 6: VISION SERVICE NOT CONFIGURED (GRACEFUL FALLBACK) ================= */}
          {scannerState === 'vision-unconfigured' && (
            <div className="bg-white rounded-3xl border border-amber-200 p-6 shadow-xl space-y-4 animate-in fade-in duration-200">
              <div className="flex items-center gap-3 pb-3 border-b border-amber-100">
                <div className="w-10 h-10 rounded-full bg-amber-100 border border-amber-300 flex items-center justify-center text-lg text-amber-700 shrink-0">
                  <i className="fa-solid fa-server"></i>
                </div>
                <div className="text-left">
                  <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[10px] font-bold font-mono">
                    VISION SERVICE NOT CONFIGURED
                  </span>
                  <h3 className="font-serif font-bold text-base text-slate-900 mt-0.5">
                    Gemini Vision Disabled
                  </h3>
                </div>
              </div>

              <p className="text-xs text-slate-600 leading-relaxed text-left">
                Optical vision OCR requires the <code className="px-1 py-0.5 rounded bg-slate-100 font-mono text-[11px] text-slate-900">GEMINI_API_KEY</code> environment variable on the server. Camera barcode scanning, manual ISBN lookup, and catalog matching are fully operational.
              </p>

              {/* Instant Search Bar Inside Fallback Card */}
              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-2 text-left">
                <label className="text-[11px] font-bold text-slate-700 flex items-center gap-1.5">
                  <i className="fa-solid fa-magnifying-glass text-amber-600"></i>
                  <span>Find by ISBN or Book Title:</span>
                </label>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (manualQuery.trim()) executeSearch(manualQuery);
                  }}
                  className="flex gap-2"
                >
                  <input
                    type="text"
                    value={manualQuery}
                    onChange={(e) => setManualQuery(e.target.value)}
                    placeholder="e.g. 9780132350884 or Clean Code"
                    className="flex-1 px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-hidden focus:border-amber-500 font-mono"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition-colors shrink-0 flex items-center gap-1.5"
                  >
                    <span>Search</span>
                  </button>
                </form>
              </div>

              {/* One-Click Demo Sample Chips */}
              <div className="p-3 rounded-2xl bg-amber-50/60 border border-amber-200/80 space-y-1.5 text-left">
                <div className="text-[11px] font-bold text-amber-950 flex items-center justify-between">
                  <span>Quick Test Samples:</span>
                  <span className="text-[10px] text-amber-700 font-normal">1-Click Match</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {displaySamples.slice(0, 3).map(sample => (
                    <button
                      key={sample.id}
                      type="button"
                      onClick={() => handleSelectDemoSample(sample)}
                      className="px-2.5 py-1 rounded-lg bg-white hover:bg-amber-100 border border-amber-200 text-amber-900 text-[11px] font-medium flex items-center gap-1.5 transition-colors shadow-2xs"
                    >
                      <i className="fa-solid fa-book-open text-[10px] text-amber-600"></i>
                      <span className="truncate max-w-[130px]">{sample.title}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-2 flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  onClick={startCamera}
                  className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition-colors flex items-center justify-center gap-1.5 shadow-sm"
                >
                  <i className="fa-solid fa-barcode text-xs"></i>
                  <span>Scan Back Barcode</span>
                </button>
                <button
                  type="button"
                  onClick={handleResetScanner}
                  className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs transition-colors"
                >
                  Return to Manual Search
                </button>
              </div>
            </div>
          )}

          {/* ================= STATE 7: CAMERA PERMISSION DENIED ================= */}
          {scannerState === 'camera-denied' && (
            <div className="bg-white rounded-3xl border border-rose-200 p-8 shadow-xl text-center space-y-4 animate-in fade-in duration-200">
              <div className="w-16 h-16 rounded-full bg-rose-50 border border-rose-300 flex items-center justify-center mx-auto text-2xl text-rose-600 shadow-sm">
                <i className="fa-solid fa-video-slash"></i>
              </div>
              <div>
                <span className="px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-900 text-xs font-bold font-mono">
                  CAMERA PERMISSION DENIED
                </span>
                <h3 className="font-serif font-bold text-lg text-slate-900 mt-2">
                  Camera Access Blocked
                </h3>
                <p className="text-xs text-slate-600 mt-1 max-w-sm mx-auto leading-relaxed">
                  Your browser blocked camera access. Please update permission settings in your browser address bar or use image upload below.
                </p>
              </div>

              <div className="pt-2">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs shadow-sm transition-all"
                >
                  Upload Cover Photo Instead
                </button>
              </div>
            </div>
          )}

          {/* ================= STATE 8: CAMERA NOT AVAILABLE ================= */}
          {scannerState === 'camera-unavailable' && (
            <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-xl text-center space-y-4 animate-in fade-in duration-200">
              <div className="w-16 h-16 rounded-full bg-slate-100 border border-slate-300 flex items-center justify-center mx-auto text-2xl text-slate-600 shadow-sm">
                <i className="fa-solid fa-plug-circle-xmark"></i>
              </div>
              <div>
                <span className="px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-800 text-xs font-bold font-mono">
                  CAMERA NOT AVAILABLE
                </span>
                <h3 className="font-serif font-bold text-lg text-slate-900 mt-2">
                  No Camera Hardware Detected
                </h3>
                <p className="text-xs text-slate-600 mt-1 max-w-sm mx-auto leading-relaxed">
                  No camera device was detected on your hardware, or the camera is currently in use by another program.
                </p>
              </div>

              <div className="pt-2">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs shadow-sm transition-all"
                >
                  Upload Cover Photo Instead
                </button>
              </div>
            </div>
          )}

          {/* ================= STATE 9: INVALID IMAGE ================= */}
          {scannerState === 'invalid-image' && (
            <div className="bg-white rounded-3xl border border-rose-200 p-8 shadow-xl text-center space-y-4 animate-in fade-in duration-200">
              <div className="w-16 h-16 rounded-full bg-rose-50 border border-rose-300 flex items-center justify-center mx-auto text-2xl text-rose-600 shadow-sm">
                <i className="fa-solid fa-file-circle-xmark"></i>
              </div>
              <div>
                <span className="px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-900 text-xs font-bold font-mono">
                  INVALID IMAGE
                </span>
                <h3 className="font-serif font-bold text-lg text-slate-900 mt-2">
                  Image Upload Rejected
                </h3>
                <p className="text-xs text-slate-600 mt-1 max-w-sm mx-auto leading-relaxed">
                  {generalError || 'The uploaded file is not a supported format or exceeds the 10MB limit. Please upload a standard JPG, PNG, or WEBP photo.'}
                </p>
              </div>

              <div className="pt-2">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs shadow-sm transition-all"
                >
                  Select Another Photo
                </button>
              </div>
            </div>
          )}

          {/* ================= RESULT: NO MATCH FOUND ================= */}
          {scannerState === 'no-match' && (
            <div className="bg-white rounded-3xl border border-slate-200/90 p-8 shadow-sm text-center animate-in fade-in duration-200">
              <div className="w-16 h-16 rounded-full bg-rose-50 border border-rose-200 flex items-center justify-center mx-auto mb-4 text-2xl text-rose-500">
                <i className="fa-solid fa-magnifying-glass-chart"></i>
              </div>
              <h3 className="font-serif font-bold text-lg text-slate-900">
                No Exact Match Found
              </h3>
              <p className="text-xs text-slate-600 mt-2 max-w-sm mx-auto leading-relaxed">
                {generalError || "We couldn't confidently identify this textbook in the BookNest campus warehouse catalog or external library records. We never invent or fake a match."}
              </p>

              {renderDetectedMetadata()}

              {/* Fallback actions */}
              <div className="mt-6 flex flex-col gap-2">
                <button
                  onClick={handleRetake}
                  className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs shadow-sm transition-all"
                >
                  Try Again with Better Lighting
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs transition-colors"
                >
                  Upload Another Image
                </button>
              </div>
            </div>
          )}

          {/* ================= DEFAULT IDLE STATE ================= */}
          {(scannerState === 'idle' || scannerState === 'camera-starting' || scannerState === 'camera-ready' || scannerState === 'captured' || scannerState === 'error') && !matchedBook && (
            <div className="bg-white rounded-3xl border border-slate-200/90 p-8 shadow-sm text-center text-slate-400">
              <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4 text-2xl text-slate-400">
                <i className="fa-solid fa-book-open-reader"></i>
              </div>
              <h3 className="font-serif font-bold text-lg text-slate-800">
                No Book Scanned Yet
              </h3>
              <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto leading-relaxed">
                Scan an ISBN barcode with your camera, upload a textbook cover photo, or enter an ISBN to view instant campus pricing and inventory.
              </p>
              
              <div className="mt-6 p-3 rounded-2xl bg-amber-50/70 border border-amber-200 text-left text-xs text-amber-900 space-y-1">
                <div className="font-bold flex items-center gap-1.5">
                  <i className="fa-solid fa-circle-check text-emerald-600"></i>
                  <span>Zero Fake Recognition Guarantee</span>
                </div>
                <div className="text-[11px] text-amber-800 leading-normal">
                  All scanner matches are computed via checksummed ISBNs, barcode detectors, or genuine string similarity algorithms.
                </div>
              </div>
            </div>
          )}

        </div>

      </div>

    </div>
  );
};
