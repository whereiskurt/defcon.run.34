'use client';

import { useRef, useState, useEffect, KeyboardEvent, ClipboardEvent } from 'react';

interface VerificationCodeInputProps {
  length?: number;
  value: string;
  onChange: (value: string) => void;
  isDisabled?: boolean;
  autoFocus?: boolean;
}

export default function VerificationCodeInput({
  length = 6,
  value,
  onChange,
  isDisabled = false,
  autoFocus = false,
}: VerificationCodeInputProps) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [focused, setFocused] = useState<number | null>(autoFocus ? 0 : null);

  // Split value into array of digits
  const digits = value.split('').slice(0, length);
  while (digits.length < length) {
    digits.push('');
  }

  useEffect(() => {
    if (autoFocus && inputRefs.current[0]) {
      inputRefs.current[0].focus();
    }
  }, [autoFocus]);

  const focusInput = (index: number) => {
    if (index >= 0 && index < length && inputRefs.current[index]) {
      inputRefs.current[index]?.focus();
      inputRefs.current[index]?.select();
    }
  };

  const handleChange = (index: number, digit: string) => {
    if (isDisabled) return;

    // Only allow single digit
    const cleanDigit = digit.replace(/\D/g, '').slice(-1);

    const newDigits = [...digits];
    newDigits[index] = cleanDigit;
    onChange(newDigits.join(''));

    // Auto-advance to next input
    if (cleanDigit && index < length - 1) {
      focusInput(index + 1);
    }
  };

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (isDisabled) return;

    if (e.key === 'Backspace') {
      if (!digits[index] && index > 0) {
        // If current is empty, go back and clear previous
        focusInput(index - 1);
        const newDigits = [...digits];
        newDigits[index - 1] = '';
        onChange(newDigits.join(''));
      } else {
        // Clear current
        const newDigits = [...digits];
        newDigits[index] = '';
        onChange(newDigits.join(''));
      }
      e.preventDefault();
    } else if (e.key === 'ArrowLeft' && index > 0) {
      focusInput(index - 1);
      e.preventDefault();
    } else if (e.key === 'ArrowRight' && index < length - 1) {
      focusInput(index + 1);
      e.preventDefault();
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    if (isDisabled) return;

    e.preventDefault();
    const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    if (pastedData) {
      onChange(pastedData);
      // Focus the next empty input or the last one
      const nextIndex = Math.min(pastedData.length, length - 1);
      focusInput(nextIndex);
    }
  };

  const handleFocus = (index: number) => {
    setFocused(index);
    inputRefs.current[index]?.select();
  };

  const handleBlur = () => {
    setFocused(null);
  };

  return (
    <div className="flex gap-2 justify-center">
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(el) => {
            inputRefs.current[index] = el;
          }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={digit}
          onChange={(e) => handleChange(index, e.target.value)}
          onKeyDown={(e) => handleKeyDown(index, e)}
          onPaste={handlePaste}
          onFocus={() => handleFocus(index)}
          onBlur={handleBlur}
          disabled={isDisabled}
          className={`
            w-10 h-12 text-center text-xl font-mono font-bold
            border-2 rounded-lg
            bg-default-100
            transition-all duration-150
            focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary
            disabled:opacity-50 disabled:cursor-not-allowed
            ${focused === index ? 'border-primary ring-2 ring-primary/20' : 'border-default-300'}
            ${digit ? 'text-foreground' : 'text-default-400'}
          `}
          aria-label={`Digit ${index + 1} of ${length}`}
        />
      ))}
    </div>
  );
}
