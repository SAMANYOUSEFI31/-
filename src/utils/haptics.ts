// Bushido Ergonomic Haptic Feedback Engine
// Conforms to Apple HIG & Material 3 haptic standards with dignified Stoic calibration

class HapticEngine {
  private isSupported(): boolean {
    return typeof window !== 'undefined' && typeof navigator !== 'undefined' && 'vibrate' in navigator;
  }

  // 1. Light micro-tap (5ms) for habit checkmark toggle (crisp physical feedback)
  lightTap() {
    try {
      if (this.isSupported()) {
        navigator.vibrate(5);
      }
    } catch {
      // Graceful fallback on unsupported devices
    }
  }

  // 2. Soft double micro-tap for unchecking a habit [5ms, 35ms pause, 5ms]
  uncheckTap() {
    try {
      if (this.isSupported()) {
        navigator.vibrate([5, 35, 5]);
      }
    } catch {}
  }

  // 3. Refined rhythmic tap for completing Standard Day (5/5 habits) [10ms, 40ms pause, 12ms]
  standardDaySuccess() {
    try {
      if (this.isSupported()) {
        navigator.vibrate([10, 40, 12]);
      }
    } catch {}
  }

  // 4. Heavy resonant double-pulse for Mastery (10/10 Score) [18ms, 50ms pause, 24ms]
  masterySuccess() {
    try {
      if (this.isSupported()) {
        navigator.vibrate([18, 50, 24]);
      }
    } catch {}
  }

  // 5. Distinct warning pattern for debt / locked day / critical autopsy [25ms, 60ms pause, 25ms]
  warningAlert() {
    try {
      if (this.isSupported()) {
        navigator.vibrate([25, 60, 25]);
      }
    } catch {}
  }

  // 6. Settled debt / autopsy saved [10ms, 35ms pause, 10ms]
  debtResolved() {
    try {
      if (this.isSupported()) {
        navigator.vibrate([10, 35, 10]);
      }
    } catch {}
  }
}

export const haptics = new HapticEngine();
