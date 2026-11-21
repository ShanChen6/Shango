import { useEffect, useRef, useState } from 'react';

const SOUND_KEY = 'shango.driver.offerSound';
const ALERT_TITLE = '🔔 Đề nghị mới · ShanGo Tài xế';

function readSoundPreference() {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'off';
  } catch {
    return true;
  }
}

/**
 * Foreground alert for a new offer (offers expire in ~20 s): flashing tab title, vibration where
 * supported and a short beep. Browsers only allow audio after a user gesture, so the AudioContext
 * is created on the first tap. This is not a push notification and does not work when suspended.
 */
export function useOfferAlert(offerId: string | null) {
  const [soundOn, setSoundOn] = useState(readSoundPreference);
  const audio = useRef<AudioContext | null>(null);
  const alerted = useRef<string | null>(null);

  useEffect(() => {
    const unlock = () => {
      if (audio.current || typeof AudioContext === 'undefined') return;
      try {
        audio.current = new AudioContext();
      } catch {
        audio.current = null;
      }
    };
    addEventListener('pointerdown', unlock, { once: true });
    addEventListener('keydown', unlock, { once: true });
    return () => {
      removeEventListener('pointerdown', unlock);
      removeEventListener('keydown', unlock);
    };
  }, []);

  useEffect(() => {
    if (!offerId || alerted.current === offerId) return;
    alerted.current = offerId;
    navigator.vibrate?.([200, 100, 200]);
    const context = audio.current;
    if (soundOn && context && context.state === 'running') {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.2, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.4);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.4);
    }
  }, [offerId, soundOn]);

  useEffect(() => {
    if (!offerId) return;
    const original = document.title;
    let on = true;
    document.title = ALERT_TITLE;
    const timer = window.setInterval(() => {
      on = !on;
      document.title = on ? ALERT_TITLE : original;
    }, 1000);
    return () => {
      window.clearInterval(timer);
      document.title = original;
    };
  }, [offerId]);

  const toggleSound = (value: boolean) => {
    setSoundOn(value);
    try {
      localStorage.setItem(SOUND_KEY, value ? 'on' : 'off');
    } catch {
      // Preference is a per-device convenience; ignore storage failures.
    }
  };
  return { soundOn, toggleSound };
}
