// Device Detection Utility
// Comprehensive device detection combining multiple signals

/**
 * Detect the device type with high accuracy
 * @returns {string} 'mobile', 'tablet', or 'desktop'
 */
export function detectDeviceType() {
    const userAgent = navigator.userAgent.toLowerCase();
    const hasTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || (navigator.msMaxTouchPoints > 0);
    const screenWidth = window.innerWidth;
    const screenHeight = window.innerHeight;
    const aspectRatio = screenHeight / screenWidth; // Height-to-width ratio

    // Check user agent for mobile/tablet patterns
    const isMobileUA = /android|webos|iphone|ipod|blackberry|iemobile|opera mini/i.test(userAgent);
    const isTabletUA = /ipad|android(?!.*mobile)|tablet|kindle|playbook|silk/i.test(userAgent);

    const detectionLog = {
        userAgent: userAgent.substring(0, 50) + '...',
        hasTouch,
        screenWidth,
        screenHeight,
        aspectRatio: aspectRatio.toFixed(2),
        isMobileUA,
        isTabletUA
    };

    // Mobile detection (most strict)
    // - Has mobile user agent AND NOT tablet UA
    if (isMobileUA && !isTabletUA) {
        console.log('[Device Detection] ✅ Mobile detected via User Agent', detectionLog);
        console.log('[Device Detection] Device Info:', { screenWidth, screenHeight, aspectRatio: aspectRatio.toFixed(2) });
        return 'mobile';
    }

    // Tablet detection
    // - Has tablet user agent AND NOT mobile UA
    if (isTabletUA && !isMobileUA) {
        console.log('[Device Detection] ✅ Tablet detected via User Agent', detectionLog);
        console.log('[Device Detection] Device Info:', { screenWidth, screenHeight, aspectRatio: aspectRatio.toFixed(2) });
        return 'tablet';
    }

    // Mobile detection for touch devices with small screen width AND portrait-like aspect ratio
    // Portrait mode: height > width (aspect ratio > 1.0)
    // Mobile phones typically: width < 768px AND aspect ratio > 0.8 (portrait or near-square)
    if (hasTouch && screenWidth < 768 && aspectRatio > 0.8) {
        console.log('[Device Detection] ✅ Mobile detected via touch + small screen + portrait aspect', detectionLog);
        console.log('[Device Detection] Mobile indicators: hasTouch=true, screenWidth=' + screenWidth + 'px (<768), aspectRatio=' + aspectRatio.toFixed(2) + ' (>0.8)');
        return 'mobile';
    }

    // Tablet detection for touch devices with medium screen size
    // Tablets typically: screenWidth >= 768px AND screenWidth < 1366px AND has touch
    if (hasTouch && screenWidth >= 768 && screenWidth < 1366 && aspectRatio > 0.5) {
        console.log('[Device Detection] ✅ Tablet detected via touch + medium screen', detectionLog);
        console.log('[Device Detection] Tablet indicators: hasTouch=true, screenWidth=' + screenWidth + 'px (768-1366), aspectRatio=' + aspectRatio.toFixed(2) + ' (>0.5)');
        return 'tablet';
    }

    // Desktop detection (everything else)
    console.log('[Device Detection] ✅ Desktop detected (default)', detectionLog);
    console.log('[Device Detection] Desktop indicators: screenWidth=' + screenWidth + 'px, aspect ratio=' + aspectRatio.toFixed(2) + ', touch=' + hasTouch);
    return 'desktop';
}

/**
 * Get device icon for display
 * @param {string} deviceType - 'mobile', 'tablet', or 'desktop'
 * @returns {string} SVG icon HTML
 */
export function getDeviceIcon(deviceType) {
    const icons = {
        mobile: `<svg class="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
            <path d="M17 2H7c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 18H7V4h10v16zm-5-1c.55 0 1-.45 1-1s-.45-1-1-1-1 .45-1 1 .45 1 1 1z"/>
        </svg>`,
        tablet: `<svg class="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
            <path d="M21 4H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H3V6h18v12zm-2-1c.55 0 1-.45 1-1s-.45-1-1-1-1 .45-1 1 .45 1 1 1z"/>
        </svg>`,
        desktop: `<svg class="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
            <path d="M21 2H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h7v2H8v2h8v-2h-2v-2h7c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H3V4h18v12z"/>
        </svg>`
    };

    return icons[deviceType] || icons.desktop;
}

/**
 * Get device label for tooltips
 * @param {string} deviceType - 'mobile', 'tablet', or 'desktop'
 * @returns {string} Human-readable device label
 */
export function getDeviceLabel(deviceType) {
    const labels = {
        mobile: 'Mobile',
        tablet: 'Tablet',
        desktop: 'Desktop'
    };

    return labels[deviceType] || 'Unknown';
}

/**
 * Get detailed device info for debugging
 * @returns {object} Device information
 */
export function getDeviceInfo() {
    const deviceType = detectDeviceType();
    const userAgent = navigator.userAgent;
    const hasTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    const screenWidth = window.innerWidth;
    const screenHeight = window.innerHeight;
    const platform = navigator.platform;

    return {
        deviceType,
        userAgent,
        hasTouch,
        screenWidth,
        screenHeight,
        platform,
        timestamp: new Date().toISOString()
    };
}
