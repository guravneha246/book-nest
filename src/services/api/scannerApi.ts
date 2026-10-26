import { request, ApiError } from './client';
import { Book } from '../../types';

export const scannerApi = {
  getStatus: async () => {
    try {
      return await request<{
        success: boolean;
        visionConfigured: boolean;
        barcodeSupported: boolean;
        isbnLookupSupported: boolean;
        catalogCount?: number;
      }>('/api/scanner/status');
    } catch {
      return {
        success: true,
        visionConfigured: false,
        barcodeSupported: true,
        isbnLookupSupported: true,
      };
    }
  },

  scanIsbn: async (isbn: string) => {
    try {
      return await request<{
        success: boolean;
        matched: boolean;
        matchType: string;
        confidence: number;
        evidence: string;
        book?: Book | null;
        candidates?: any[];
        isLocalCatalog?: boolean;
        error?: string;
        detectedIsbn?: string;
      }>('/api/scanner/isbn', {
        method: 'POST',
        body: JSON.stringify({ isbn }),
      });
    } catch (err: any) {
      if (err instanceof ApiError && err.data) {
        return err.data;
      }
      throw err;
    }
  },

  scanVision: async (imageBase64: string, mimeType?: string) => {
    try {
      return await request<{
        success: boolean;
        matched: boolean;
        matchType: string;
        confidence: number;
        evidence: string;
        book?: Book | null;
        candidates?: any[];
        detectedMetadata?: any;
        isLocalCatalog?: boolean;
        error?: string;
      }>('/api/scanner/analyze', {
        method: 'POST',
        body: JSON.stringify({ imageBase64, mimeType }),
      });
    } catch (err: any) {
      if (err instanceof ApiError && err.data) {
        return err.data;
      }
      throw err;
    }
  },

  matchText: async (queryOrData: string | { query?: string; title?: string; author?: string; isbn?: string; rawTextLines?: string[] }) => {
    try {
      const body = typeof queryOrData === 'string' ? { query: queryOrData } : queryOrData;
      return await request<{
        success: boolean;
        matched: boolean;
        matchType: string;
        confidence: number;
        evidence: string;
        book?: Book | null;
        candidates?: any[];
        error?: string;
      }>('/api/scanner/match-text', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    } catch (err: any) {
      if (err instanceof ApiError && err.data) {
        return err.data;
      }
      throw err;
    }
  },
};
