Quick setup for `SupplierProfile` component

1. Place `SupplierProfile.jsx` under `frontend/src` (done).
2. Ensure your frontend build uses React and can import this component. Example (in a React app):

- In `App.jsx`:

import SupplierProfile from './SupplierProfile'

function App(){
  return <SupplierProfile />
}

3. Store supplier token after login in `localStorage.setItem('supplierToken', token)`.
4. Start backend and frontend. The component makes requests to `/api/suppliers/*` endpoints.

Test product upload with the form in the UI.
