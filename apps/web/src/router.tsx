import { createBrowserRouter } from "react-router";
import Landing from "./landing/Landing";
import { AppLayout, MarketingLayout } from "./routes/layouts";
import { Placeholder } from "./routes/Placeholder";

// Routes from ARCHITECTURE §10. A static host must serve index.html for every path (PLAN 4.9).
export const router = createBrowserRouter([
  {
    element: <MarketingLayout />,
    children: [{ path: "/", element: <Landing /> }],
  },
  {
    element: <AppLayout />,
    children: [
      { path: "/deals", element: <Placeholder title="My deals" /> },
      { path: "/deals/new", element: <Placeholder title="New deal" /> },
      { path: "/deals/:id", element: <Placeholder title="Deal" /> },
      { path: "/attest/:id", element: <Placeholder title="Attest" /> },
      { path: "/arbiter/:id", element: <Placeholder title="Arbiter" /> },
      { path: "*", element: <Placeholder title="Not found" /> },
    ],
  },
]);
