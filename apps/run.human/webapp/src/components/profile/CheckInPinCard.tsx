'use client';

import { Card, CardBody, Button } from '@heroui/react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiUrl } from '@/lib/api';
import PinPicker, { type PinOption } from './PinPicker';

/**
 * Profile card: the runner's default check-in pin (icon + color).
 * Saved to preferences; each new check-in stamps a copy (the check-in modal
 * can still override per check-in).
 */
export default function CheckInPinCard() {
  const [icons, setIcons] = useState<PinOption[]>([]);
  const [icon, setIcon] = useState('');
  const [color, setColor] = useState('');
  const [saved, setSaved] = useState<{ icon: string; color: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    fetch(apiUrl('/api/checkins/pin-options'))
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        setIcons(data.icons);
        setIcon(data.pinIcon);
        setColor(data.pinColor);
        setSaved({ icon: data.pinIcon, color: data.pinColor });
      })
      .catch(() => {});
  }, []);

  const dirty = saved !== null && (saved.icon !== icon || saved.color !== color);

  const save = async () => {
    setSaving(true);
    setError(false);
    try {
      const res = await fetch(apiUrl('/api/user'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinIcon: icon, pinColor: color }),
      });
      if (!res.ok) throw new Error();
      setSaved({ icon, color });
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  };

  if (!icons.length) return null;

  return (
    <Card className="glass-card overflow-hidden">
      <CardBody className="px-5 py-3">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 w-full text-left cursor-pointer hover:opacity-80 transition-opacity"
        >
          {isOpen ? (
            <ChevronDown className="w-3.5 h-3.5 text-default-400" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-default-400" />
          )}
          <span className="font-museo text-base font-bold text-foreground">Check-in Pin</span>
        </button>
        {isOpen && (
          <div className="space-y-3 mt-3">
            <p className="text-xs text-default-400">
              How your public check-ins appear on the map. You can still swap it for
              a single check-in.
            </p>
            <PinPicker
              icons={icons}
              icon={icon}
              color={color}
              onChange={(pin) => {
                setIcon(pin.icon);
                setColor(pin.color);
              }}
            />
            <div className="flex items-center gap-2">
              <Button size="sm" color="primary" isDisabled={!dirty} isLoading={saving} onPress={save}>
                Save pin
              </Button>
              {error && <span className="text-danger text-xs">Could not save - try again</span>}
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
