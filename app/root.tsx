import {
  isRouteErrorResponse,
  Link,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import { AuthProvider } from "./auth/session";
import {
  SiteFooter,
  SiteHeader,
  SkipLink,
} from "./components/site-chrome";
import { GroupRail } from "./components/site-nav";
import type { Route } from "./+types/root";
import "./app.css";

// Inter is self-hosted: its @font-face rules live in app.css and the woff2
// files in app/fonts, so nothing here reaches out to a third-party origin.
// Do not reintroduce the Google Fonts <link> elements that used to sit here.
// They leaked every visitor's IP address to Google and would force
// style-src https://fonts.googleapis.com and font-src https://fonts.gstatic.com
// into this app's Content-Security-Policy for as long as they existed.
export const links: Route.LinksFunction = () => [];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {/*
          The session is resolved once per document load, here, rather than by
          each page that happens to care. It wraps the header as well as the
          outlet because the account control in the header needs the same
          answer every page does, and two consumers must never be able to
          disagree about who is signed in.

          On this site that provider does nothing at all during the build: it
          starts in a `loading` state and only asks the server who the reader
          is after hydration. That is what keeps identity out of the ~130
          static HTML files nginx serves to everybody — see
          app/auth/session.tsx.
        */}
        <AuthProvider>
          <SkipLink />
          <SiteHeader />
          {/*
            The rail is a sibling of `<main>`, not a child of it: it is site
            navigation, and putting a second `<nav>` inside the main landmark
            would make "where am I in this group" part of the page's content.
            `.site-body` is `display: contents` on every page the rail declines
            to render on, so those pages have exactly the box model they had
            before it existed.
          */}
          <div className="site-body">
            <GroupRail />
            <main id="main" tabIndex={-1}>
              {children}
            </main>
          </div>
          <SiteFooter />
        </AuthProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let heading = "Something went wrong";
  // The most likely cause on a fully pre-rendered site is an address that was
  // never published, so the fallback copy says so rather than leaving a reader
  // staring at "an unexpected error occurred".
  let details =
    "That page could not be loaded. If you typed the address, it may not exist.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    heading = error.status === 404 ? "Page not found" : "Error";
    details =
      error.status === 404
        ? "That page does not exist. It may have been a mistyped address."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <div className="page">
      <h1>{heading}</h1>
      <p className="lede">{details}</p>
      <p>
        <Link to="/">Return to the home page</Link> or use the search field in
        the header.
      </p>
      {stack && (
        <pre className="table-scroll">
          <code>{stack}</code>
        </pre>
      )}
    </div>
  );
}
