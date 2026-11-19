import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import '../styles/desktop-shell.css';

/** Shared navigation surface for the catalog and title detail. */
export const AppHeader = forwardRef<HTMLElement, ComponentPropsWithoutRef<'header'>>(
  function AppHeader({ children, className = '', ...props }, ref) {
    return <header {...props} ref={ref} className={`${className} desktop-header`}>{children}</header>;
  },
);
