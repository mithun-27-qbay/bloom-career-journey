import { useState, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';

declare global {
  interface Window {
    initSendOTP: (config: any) => void;
    sendOtp: (identifier: string, successCb: (data: any) => void, failureCb: (err: any) => void) => void;
    verifyOtp: (otp: string, successCb: (data: any) => void, failureCb: (err: any) => void) => void;
    retryOtp: (channel: string | null, successCb: (data: any) => void, failureCb: (err: any) => void) => void;
    MSG91?: any;
  }
}

export const useMsg91 = () => {
  const [isReady, setIsReady] = useState(false);
  const [widgetInitialized, setWidgetInitialized] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifiedToken, setVerifiedToken] = useState<string | null>(null);
  const { toast } = useToast();

  // Load the MSG91 widget script on first use
  const ensureScriptLoaded = useCallback((): Promise<boolean> => {
    return new Promise((resolve) => {
      if (typeof window.initSendOTP === 'function') {
        setIsReady(true);
        resolve(true);
        return;
      }

      const urls = [
        'https://verify.msg91.com/otp-provider.js',
        'https://verify.phone91.com/otp-provider.js'
      ];

      let i = 0;
      const attempt = () => {
        if (i >= urls.length) {
          resolve(false);
          return;
        }
        if (document.querySelector(`script[src="${urls[i]}"]`)) {
          if (typeof window.initSendOTP === 'function') {
            setIsReady(true);
            resolve(true);
          } else {
            resolve(false);
          }
          return;
        }

        const s = document.createElement('script');
        s.src = urls[i];
        s.async = true;
        s.onload = () => {
          if (typeof window.initSendOTP === 'function') {
            console.log('[MSG91] Widget script loaded');
            setIsReady(true);
            resolve(true);
          } else {
            i++;
            attempt();
          }
        };
        s.onerror = () => { i++; attempt(); };
        document.head.appendChild(s);
      };
      attempt();
    });
  }, []);

  // Initialize the widget with exposeMethods
  const initWidget = useCallback((identifier: string): boolean => {
    if (typeof window.initSendOTP !== 'function') return false;

    try {
      window.initSendOTP({
        widgetId: import.meta.env.VITE_MSG91_WIDGET_ID,
        tokenAuth: import.meta.env.VITE_MSG91_TOKEN,
        identifier,
        exposeMethods: true,
        success: (data: any) => {
          console.log('[MSG91] Widget success:', data);
          setVerifiedToken(data?.message || data || 'verified');
        },
        failure: (error: any) => {
          console.warn('[MSG91] Widget failure:', error);
        },
      });
      setWidgetInitialized(true);
      console.log('[MSG91] Widget initialized for:', identifier);
      return true;
    } catch (err) {
      console.error('[MSG91] Widget init error:', err);
      return false;
    }
  }, []);

  // Send OTP: try widget first, fall back to backend
  const sendOtpCode = useCallback(async (mobile: string): Promise<{ success: boolean; error?: string }> => {
    setIsVerifying(true);
    const cleanMobile = mobile.replace(/^\+/, '');

    // Step 1: Try widget SDK (uses MSG91's default DLT template)
    try {
      await ensureScriptLoaded();

      if (!widgetInitialized) {
        initWidget(cleanMobile);
      }

      // Wait briefly for widget to set up exposed methods
      await new Promise(r => setTimeout(r, 600));

      if (typeof window.sendOtp === 'function') {
        const widgetResult = await new Promise<{ success: boolean; error?: string }>((resolve) => {
          window.sendOtp(
            cleanMobile,
            (data: any) => {
              console.log('[MSG91] Widget sendOtp success:', data);
              resolve({ success: true });
            },
            (error: any) => {
              console.warn('[MSG91] Widget sendOtp failed:', error);
              resolve({ success: false, error: error?.message || 'IPBlocked' });
            }
          );
          // Timeout after 5 seconds
          setTimeout(() => resolve({ success: false, error: 'Widget timeout' }), 5000);
        });

        if (widgetResult.success) {
          toast({
            title: "OTP Sent",
            description: "Please check your mobile for the 4-digit verification code.",
          });
          setIsVerifying(false);
          return { success: true };
        }
        console.log('[MSG91] Widget failed, falling back to backend...');
      }
    } catch (err) {
      console.warn('[MSG91] Widget error, falling back to backend:', err);
    }

    // Step 2: Fall back to backend API
    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';
      const response = await fetch(`${backendUrl}/api/auth/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mobile: cleanMobile })
      });

      const result = await response.json();
      console.log('[OTP] Backend send result:', result);

      if (response.ok && result.success) {
        if (result.devOtp && !result.smsDelivered) {
          toast({
            title: "OTP Generated",
            description: `Your code is: ${result.devOtp} (SMS delivery pending - use this code)`,
          });
        } else {
          toast({
            title: "OTP Sent",
            description: "Please check your mobile for the 4-digit verification code.",
          });
        }
        setIsVerifying(false);
        return { success: true };
      } else {
        throw new Error(result.error || 'Failed to send OTP');
      }
    } catch (error: any) {
      console.error('[OTP] Send failed:', error);
      toast({
        title: "Error",
        description: error.message || "Could not send OTP code.",
        variant: "destructive"
      });
      setIsVerifying(false);
      return { success: false, error: error.message };
    }
  }, [widgetInitialized, ensureScriptLoaded, initWidget, toast]);

  // Verify OTP via backend API (avoids widget IPBlocked on verify)
  const verifyOtpCode = useCallback(async (mobile: string, otp: string): Promise<{ success: boolean; error?: string }> => {
    setIsVerifying(true);
    try {
      const cleanMobile = mobile.replace(/^\+/, '');
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';

      console.log('[OTP] Verifying via backend for:', cleanMobile);
      const response = await fetch(`${backendUrl}/api/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mobile: cleanMobile, otp })
      });

      const result = await response.json();
      console.log('[OTP] Verify result:', result);

      if (response.ok && result.success) {
        setVerifiedToken('verified');
        toast({
          title: "Verified!",
          description: "Mobile number verified successfully.",
        });
        return { success: true };
      } else {
        const errMsg = result.error || 'OTP verification failed';
        toast({
          title: "Verification Failed",
          description: errMsg,
          variant: "destructive"
        });
        return { success: false, error: errMsg };
      }
    } catch (error: any) {
      console.error('[OTP] Verify Error:', error);
      toast({
        title: "Verification Failed",
        description: error.message || "Invalid OTP code.",
        variant: "destructive"
      });
      return { success: false, error: error.message };
    } finally {
      setIsVerifying(false);
    }
  }, [toast]);

  // Legacy
  const openWidget = useCallback((_id?: string) => {}, []);
  const verifyTokenWithBackend = async (t: string) => ({ success: true, data: t });

  return {
    isReady: true,
    isVerifying,
    verifiedToken,
    openWidget,
    sendOtpCode,
    verifyOtpCode,
    verifyTokenWithBackend,
    resetVerification: useCallback(() => {
      setVerifiedToken(null);
      setWidgetInitialized(false);
    }, [])
  };
};
