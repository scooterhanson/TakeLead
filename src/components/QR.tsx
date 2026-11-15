import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

export function QR({ value, size = 200, className = '' }: { value: string; size?: number; className?: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    QRCode.toDataURL(value, { margin: 1, width: size * 2, errorCorrectionLevel: 'M' })
      .then(setSrc)
      .catch(() => setSrc(''));
  }, [value, size]);
  return src ? (
    <img className={`qr ${className}`} src={src} width={size} height={size} alt={`QR code for ${value}`} />
  ) : (
    <div className={`qr ${className}`} style={{ width: size, height: size }} />
  );
}
