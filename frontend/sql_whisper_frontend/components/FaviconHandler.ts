'use client';

import { useEffect } from 'react';
import { useTheme } from 'next-themes';

export default function FaviconHandler()
{
    const { resolvedTheme } = useTheme();

    useEffect(() => {
        let link = document.querySelector("link[rel*='icon']") as HTMLLinkElement;

        if (!link) {
            link = document.createElement('link');
            link.rel = 'icon';
            document.head.appendChild(link);
        }

        if (resolvedTheme === 'dark') {
            link.href = '/logo_dark.png';
        } else {
            link.href = '/logo_light.png';
        }
    }, [resolvedTheme]);

    return null;
}