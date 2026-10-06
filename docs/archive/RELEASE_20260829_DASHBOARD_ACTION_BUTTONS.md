# RideArrivo Dashboard Action Buttons Fix

Fixes the two secondary actions in the personalized dashboard hero so **My Tasks** and **Projects** remain clearly visible over the dark RideArrivo hero in both light and dark appearance modes.

The global workspace shell deliberately forces `.glassButton` to a white surface using `!important`. The dashboard previously applied white text from the dark hero context without overriding that white global surface, producing white-on-white buttons. This release gives the two hero actions a dedicated contextual class, explicit translucent-dark-hero treatment, hover/focus states, and stable icon/text alignment.

No database, Supabase, gateway, or dependency changes are included.
