'use client';

/**
 * Device detection utilities for MIRA
 */

export interface DeviceInfo {
  isMobile: boolean;
  isAndroid: boolean;
  isIOS: boolean;
  isMIRAAndroid: boolean; // Running in MIRA Android app WebView
  isTablet: boolean;
  isDesktop: boolean;
  userAgent: string;
}

/**
 * Detect device type from user agent and screen size
 */
export function getDeviceInfo(): DeviceInfo {
  if (typeof window === 'undefined') {
    return {
      isMobile: false,
      isAndroid: false,
      isIOS: false,
      isMIRAAndroid: false,
      isTablet: false,
      isDesktop: true,
      userAgent: '',
    };
  }

  const ua = navigator.userAgent || '';
  const isAndroid = /Android/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const isMIRAAndroid = /MIRAAndroid/i.test(ua);
  
  // Check screen size for tablet detection
  const screenWidth = window.screen.width;
  const isTabletSize = screenWidth >= 600 && screenWidth <= 1024;
  const isTablet = isTabletSize && (isAndroid || isIOS);
  
  // Mobile if Android or iOS and not tablet-sized, or if in MIRA Android app
  const isMobile = (isAndroid || isIOS) && !isTablet || isMIRAAndroid;
  const isDesktop = !isMobile && !isTablet;

  return {
    isMobile,
    isAndroid,
    isIOS,
    isMIRAAndroid,
    isTablet,
    isDesktop,
    userAgent: ua,
  };
}

/**
 * Check if running on mobile device
 */
export function isMobileDevice(): boolean {
  return getDeviceInfo().isMobile;
}

/**
 * Check if running in MIRA Android app
 */
export function isMIRAAndroidApp(): boolean {
  return getDeviceInfo().isMIRAAndroid;
}

/**
 * Check if running on Android (browser or app)
 */
export function isAndroidDevice(): boolean {
  return getDeviceInfo().isAndroid;
}

/**
 * Check if face detection should be enabled
 * Disabled on mobile devices due to performance and battery concerns
 */
export function shouldEnableFaceDetection(): boolean {
  const device = getDeviceInfo();
  // Only enable face detection on desktop
  return device.isDesktop;
}

/**
 * Check if camera should be auto-started
 * Only on desktop for face detection
 */
export function shouldAutoStartCamera(): boolean {
  return shouldEnableFaceDetection();
}

/**
 * Get optimal capture interval based on device
 */
export function getOptimalCaptureInterval(): number {
  const device = getDeviceInfo();
  if (device.isMobile) {
    return 30000; // 30 seconds on mobile (if camera is manually enabled)
  }
  return 10000; // 10 seconds on desktop
}
