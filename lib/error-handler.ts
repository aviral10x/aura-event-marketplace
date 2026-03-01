// lib/error-handler.ts
export class AppError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function handleFirebaseError(error: any): string {
  console.error('Firebase error:', error);

  // Map Firebase error codes to user-friendly messages
  const errorMap: Record<string, string> = {
    // Auth errors
    'auth/email-already-in-use': 'This email is already registered',
    'auth/invalid-email': 'Please enter a valid email address',
    'auth/weak-password': 'Password must be at least 6 characters',
    'auth/user-not-found': 'No account found with this email',
    'auth/wrong-password': 'Incorrect password',
    'auth/too-many-requests': 'Too many attempts. Please try again later',
    'auth/network-request-failed': 'Network error. Check your connection',
    
    // Firestore errors
    'permission-denied': 'You don\'t have permission to do this',
    'not-found': 'Resource not found',
    'already-exists': 'This already exists',
    'unauthenticated': 'Please sign in to continue',
    
    // Storage errors
    'storage/unauthorized': 'Please sign in to upload files',
    'storage/canceled': 'Upload was canceled',
    'storage/unknown': 'Upload failed. Please try again',
    'storage/object-not-found': 'File not found',
    'storage/quota-exceeded': 'Storage quota exceeded',
    'storage/unauthenticated': 'Please sign in to upload',
  };

  // Check if error has a code property
  if (error?.code && errorMap[error.code]) {
    return errorMap[error.code];
  }

  // Check if error message contains known patterns
  const errorMessage = error?.message?.toLowerCase() || '';
  
  if (errorMessage.includes('permission') || errorMessage.includes('unauthorized')) {
    return 'You don\'t have permission to do this';
  }
  
  if (errorMessage.includes('network')) {
    return 'Network error. Please check your connection';
  }
  
  if (errorMessage.includes('quota')) {
    return 'Storage limit reached';
  }

  // Default fallback
  return 'Something went wrong. Please try again.';
}

export function handleApiError(error: any): { message: string; statusCode: number } {
  if (error instanceof AppError) {
    return {
      message: error.message,
      statusCode: error.statusCode,
    };
  }

  // Firebase error
  if (error?.code) {
    return {
      message: handleFirebaseError(error),
      statusCode: 400,
    };
  }

  // Generic error
  return {
    message: 'An unexpected error occurred',
    statusCode: 500,
  };
}
