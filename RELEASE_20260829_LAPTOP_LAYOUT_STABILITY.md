# RideArrivo Laptop Layout Stability Fix

This corrective release keeps the authenticated RideArrivo workstation stable on common 15-16 inch Windows laptops.

## Changes

- Laptop frame geometry is now controlled by the responsive shell instead of the personal workstation-size preference.
- Workstation size preference remains available for wide desktop displays.
- 15-16 inch laptops keep a consistent centred frame when browser chrome or Windows scaling reduces viewport height.
- Labelled sidebar remains available from 1080 CSS pixels upward, which covers common 1366px Windows laptops at 125% display scaling.
- Short-height laptop rules reduce spacing only; they no longer switch the shell into a different navigation structure.
- Appearance settings explain that laptop sizing is automatic.

No database migration, dependency, or gateway change is included.
