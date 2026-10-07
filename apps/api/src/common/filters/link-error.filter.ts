export enum LinkErrorCode {
  EXPIRED = 'EXPIRED',
  INVALID = 'INVALID',
  USED = 'USED',
  DENIED = 'DENIED',
  RATE_LIMITED = 'RATE_LIMITED',
  SUCCESS = 'SUCCESS',
  FAILURE = 'FAILURE',
}

export interface LinkError {
  code: LinkErrorCode;
  message: string;
  actionable: boolean;
}

export class LinkErrorFilter {
  static getErrorMessage(code: LinkErrorCode): string {
    switch (code) {
      case LinkErrorCode.EXPIRED:
        return 'This link has expired. Please request a new one via IM.';
      case LinkErrorCode.INVALID:
        return 'This link is invalid. Please request a new one via IM.';
      case LinkErrorCode.USED:
        return 'This link has already been used. Please request a new one via IM.';
      case LinkErrorCode.DENIED:
        return 'Access denied. Please check your permissions or request access via IM.';
      case LinkErrorCode.RATE_LIMITED:
        return 'Too many requests. Please wait a moment and try again.';
      case LinkErrorCode.SUCCESS:
        return 'Your submission was successful.';
      case LinkErrorCode.FAILURE:
        return 'Your submission failed. Please try again or contact support via IM.';
      default:
        return 'An error occurred. Please try again.';
    }
  }

  static createError(code: LinkErrorCode): LinkError {
    return {
      code,
      message: this.getErrorMessage(code),
      actionable: code !== LinkErrorCode.SUCCESS && code !== LinkErrorCode.FAILURE,
    };
  }
}
