'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

export function PathnameBinder() {
  const pathname = usePathname();

  useEffect(() => {
    // Add pathname as data attribute to body
    document.body.setAttribute('data-pathname', pathname);
    
    return () => {
      // Clean up on unmount
      document.body.removeAttribute('data-pathname');
    };
  }, [pathname]);

  return null; // This component renders nothing
}