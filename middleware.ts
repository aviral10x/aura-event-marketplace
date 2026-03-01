// middleware.ts
/**
 * Next.js Edge Middleware
 * Applies security headers and rate limiting at the edge
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getSecurityHeaders, getCORSHeaders, isOriginAllowed } from '@/lib/security-headers';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const origin = request.headers.get('origin');

  // Create response
  const response = NextResponse.next();

  // Apply security headers to all routes
  const securityHeaders = getSecurityHeaders({
    enableCSP: !pathname.startsWith('/api'), // Disable CSP for API routes
    enableHSTS: true,
    enableFrameGuard: true,
  });

  Object.entries(securityHeaders).forEach(([key, value]) => {
    response.headers.set(key, value);
  });

  // Apply CORS headers for API routes
  if (pathname.startsWith('/api')) {
    // Check origin
    if (origin && isOriginAllowed(origin)) {
      const corsHeaders = getCORSHeaders({
        origin,
        credentials: true,
      });

      Object.entries(corsHeaders).forEach(([key, value]) => {
        response.headers.set(key, value);
      });
    }

    // Handle preflight
    if (request.method === 'OPTIONS') {
      return new NextResponse(null, {
        status: 204,
        headers: response.headers,
      });
    }
  }

  // Block suspicious user agents
  const userAgent = request.headers.get('user-agent') || '';
  const suspiciousPatterns = [
    'sqlmap',
    'nikto',
    'nmap',
    'masscan',
    'scanner',
    'bot', // Be careful with this, might block legitimate bots
  ];

  if (suspiciousPatterns.some((pattern) => userAgent.toLowerCase().includes(pattern))) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  // Block requests with suspicious query parameters
  const searchParams = request.nextUrl.searchParams;
  const suspiciousParams = ['<script', 'javascript:', 'onerror=', 'onclick='];

  for (const [key, value] of searchParams.entries()) {
    if (
      suspiciousParams.some((pattern) => 
        key.toLowerCase().includes(pattern) || value.toLowerCase().includes(pattern)
      )
    ) {
      return new NextResponse('Bad Request', { status: 400 });
    }
  }

  return response;
}

// Configure which routes the middleware runs on
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
