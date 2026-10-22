import { createBrowserRouter } from "react-router";
import Landing from "./landing/Landing";
import { MarketingLayout } from "./routes/MarketingLayout";
import { Placeholder } from "./routes/Placeholder";

// Routes from ARCHITECTURE §10. A static host must serve index.html for every path (PLAN 4.9).
export const router = createBrowserRouter([
  {
    element: <MarketingLayout />,
    children: [{ path: "/", element: <Landing /> }],
  },
  {
    lazy: () => import("./routes/AppRoot"),
    children: [
      { path: "/deals", element: <Placeholder title="My deals" /> },
      {
        path: "/deals/new",
        lazy: () => import("./deals/NewDealPage").then((m) => ({ Component: m.NewDealPage })),
      },
      {
        path: "/deals/:id",
        lazy: () => import("./deals/DealPage").then((m) => ({ Component: m.DealPage })),
      },
      {
        path: "/attest/:id",
        lazy: () => import("./attest/AttestPage").then((m) => ({ Component: m.AttestPage })),
      },
      { path: "/arbiter/:id", element: <Placeholder title="Arbiter" /> },
      { path: "*", element: <Placeholder title="Not found" /> },
    ],
  },
]);
