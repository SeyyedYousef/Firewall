// Referral service for handling referral events and API calls

export interface ReferralStats {
  tracked: number;
  activated: number;
  pending: number;
  xpEarned: number;
}

export interface ReferralRecord {
  id: string;
  referrerId: string;
  referredUserId: string;
  source?: string;
  trackedAt: string;
  activatedAt?: string;
  purchaseAmount?: number;
}

// Trigger referral tracked event
export function triggerReferralTracked(referralId?: string, reward?: number): void {
  const event = new CustomEvent('referral:tracked', {
    detail: { referralId, reward }
  });
  window.dispatchEvent(event);
}

// Trigger referral activated event
export function triggerReferralActivated(referralId?: string, reward?: number): void {
  const event = new CustomEvent('referral:activated', {
    detail: { referralId, reward }
  });
  window.dispatchEvent(event);
}

// API calls for referral system
const API_BASE = '/api/referrals';

export async function trackReferral(referrerId: string, newUserId: string, source?: string): Promise<void> {
  const response = await fetch(`${API_BASE}/track`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      referrerId,
      newUserId,
      source: source || 'web-app'
    })
  });

  if (!response.ok) {
    throw new Error('Failed to track referral');
  }

  const result = await response.json();
  
  // Trigger tracked event
  triggerReferralTracked(result.referralId);
}

export async function activateReferral(referredUserId: string, purchaseAmount?: number): Promise<void> {
  const response = await fetch(`${API_BASE}/activate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Init-Data': window.Telegram?.WebApp?.initData || '',
    },
    body: JSON.stringify({
      referredUserId,
      purchaseAmount
    })
  });

  if (!response.ok) {
    throw new Error('Failed to activate referral');
  }

  const result = await response.json();
  
  // Trigger activated event with XP reward
  triggerReferralActivated(result.referralId, 100); // Default 100 XP
}

// Type definition for Telegram WebApp
declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData?: string;
        initDataUnsafe?: {
          user?: {
            id: number;
            first_name: string;
            last_name?: string;
            username?: string;
          };
        };
        showAlert?: (message: string) => void;
        close?: () => void;
      };
    };
  }
}

export async function getReferralStats(): Promise<ReferralStats> {
  const response = await fetch(`${API_BASE}/stats`, {
    method: 'GET',
    headers: {
      'X-Telegram-Init-Data': window.Telegram?.WebApp?.initData || '',
    }
  });

  if (!response.ok) {
    throw new Error('Failed to fetch referral stats');
  }

  return response.json();
}

export async function getReferralList(): Promise<ReferralRecord[]> {
  const response = await fetch(`${API_BASE}/list`, {
    method: 'GET',
    headers: {
      'X-Telegram-Init-Data': window.Telegram?.WebApp?.initData || '',
    }
  });

  if (!response.ok) {
    throw new Error('Failed to fetch referral list');
  }

  const result = await response.json();
  return result.referrals;
}

// Initialize referral tracking from URL parameters
export function initializeReferralTracking(): void {
  const urlParams = new URLSearchParams(window.location.search);
  const referralCode = urlParams.get('ref');
  
  if (referralCode && window.Telegram?.WebApp?.initDataUnsafe?.user?.id) {
    const newUserId = window.Telegram.WebApp.initDataUnsafe.user.id.toString();
    
    // Track the referral
    trackReferral(referralCode, newUserId, 'web-app-url')
      .then(() => {
        console.log('Referral tracked successfully');
      })
      .catch((error) => {
        console.warn('Failed to track referral:', error);
      });
  }
}

// Auto-initialize when module loads
if (typeof window !== 'undefined') {
  // Wait for Telegram WebApp to be ready
  if (window.Telegram?.WebApp) {
    initializeReferralTracking();
  } else {
    window.addEventListener('load', () => {
      setTimeout(initializeReferralTracking, 1000);
    });
  }
}
