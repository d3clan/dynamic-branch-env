import { HTMLAttributes, forwardRef } from 'react';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info';
}

const variantStyles = {
  default: 'bg-gray-100 text-gray-700',
  success: 'bg-green-100 text-green-800',
  warning: 'bg-yellow-100 text-yellow-800',
  danger: 'bg-red-100 text-red-800',
  info: 'bg-blue-100 text-blue-800',
};

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className = '', variant = 'default', children, ...props }, ref) => {
    return (
      <span
        ref={ref}
        className={`
          inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium
          ${variantStyles[variant]}
          ${className}
        `}
        {...props}
      >
        {children}
      </span>
    );
  },
);

Badge.displayName = 'Badge';

export function getStatusBadgeVariant(
  status: string,
): BadgeProps['variant'] {
  switch (status.toUpperCase()) {
    case 'ACTIVE':
    case 'HEALTHY':
    case 'RUNNING':
      return 'success';
    case 'CREATING':
    case 'UPDATING':
    case 'PENDING':
      return 'info';
    case 'FAILED':
    case 'ERROR':
    case 'UNHEALTHY':
      return 'danger';
    case 'DESTROYING':
    case 'DRAINING':
      return 'warning';
    default:
      return 'default';
  }
}
