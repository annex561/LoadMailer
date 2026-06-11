/**
 * SEO pre-render middleware.
 *
 * Public-facing pages with valuable SEO are intercepted before the SPA
 * catch-all. Each route reads dist/public/index.html (the built SPA shell),
 * injects route-specific <title>, meta description, OpenGraph + Twitter
 * tags, JSON-LD structured data, and a content-rich <noscript> fallback so
 * Google indexes the page even before React hydrates.
 *
 * React still hydrates normally on the client — this only adds initial HTML
 * for crawlers. No JS bundle changes, no double-render.
 */

import fs from "fs";
import path from "path";
import type { Express, Request, Response } from "express";

interface SeoPageConfig {
  path: string;
  title: string;
  description: string;
  canonicalUrl: string;
  ogImage?: string;
  jsonLd: object | object[];
  fallbackHtml: string;
}

const SEO_PAGES: SeoPageConfig[] = [
  {
    path: "/drive-with-lamp",
    title:
      "Box Truck Driver Jobs — LAMP Logistics | $4,000–$6,000/Week | Most Loads No CDL",
    description:
      "Drive for LAMP Logistics. Box truck drivers earn $4,000–$6,000 a week. Owner-operators get 80/20 split, company drivers $1,200/wk minimum. Paid every Friday. Most loads do not require a CDL. Apply in 5 minutes.",
    canonicalUrl: "https://traqiq.app/drive-with-lamp",
    ogImage: "https://traqiq.app/og-drive-with-lamp.png",
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "JobPosting",
        title: "Box Truck Driver — Owner-Operator (80/20 split)",
        description:
          "LAMP Logistics is hiring box truck owner-operators. 80/20 revenue split, weekly settlements, dedicated dispatcher, no forced dispatch. Most loads do not require a CDL.",
        datePosted: new Date().toISOString().slice(0, 10),
        validThrough: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10),
        employmentType: "CONTRACTOR",
        hiringOrganization: {
          "@type": "Organization",
          name: "LAMP Logistics",
          sameAs: "https://traqiq.app",
          identifier: { "@type": "PropertyValue", name: "USDOT", value: "4397421" },
        },
        jobLocation: {
          "@type": "Place",
          address: {
            "@type": "PostalAddress",
            addressCountry: "US",
            addressRegion: "TN",
            addressLocality: "Chattanooga",
          },
        },
        baseSalary: {
          "@type": "MonetaryAmount",
          currency: "USD",
          value: {
            "@type": "QuantitativeValue",
            minValue: 4000,
            maxValue: 6000,
            unitText: "WEEK",
          },
        },
        qualifications:
          "Valid driver's license, clean MVR, current DOT physical, no DUI in last 5 years, ability to pass DOT drug test and FMCSA Clearinghouse query.",
        responsibilities:
          "Operate box truck on dedicated and OTR freight, complete pre- and post-trip inspections, communicate with dispatch.",
        applicantLocationRequirements: {
          "@type": "Country",
          name: "United States",
        },
        directApply: true,
      },
      {
        "@context": "https://schema.org",
        "@type": "JobPosting",
        title: "Box Truck Driver — Company Driver (Lease-On)",
        description:
          "LAMP Logistics is hiring box truck company drivers on a lease-on contractor model. $1,200/week minimum, mileage bonuses on top, fuel covered, no truck payment. Weekly settlements.",
        datePosted: new Date().toISOString().slice(0, 10),
        validThrough: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10),
        employmentType: "CONTRACTOR",
        hiringOrganization: {
          "@type": "Organization",
          name: "LAMP Logistics",
          sameAs: "https://traqiq.app",
          identifier: { "@type": "PropertyValue", name: "USDOT", value: "4397421" },
        },
        jobLocation: {
          "@type": "Place",
          address: {
            "@type": "PostalAddress",
            addressCountry: "US",
            addressRegion: "TN",
            addressLocality: "Chattanooga",
          },
        },
        baseSalary: {
          "@type": "MonetaryAmount",
          currency: "USD",
          value: {
            "@type": "QuantitativeValue",
            value: 1200,
            unitText: "WEEK",
          },
        },
        qualifications:
          "Valid driver's license, clean MVR, current DOT physical, no DUI in last 5 years, ability to pass DOT drug test and FMCSA Clearinghouse query.",
        directApply: true,
      },
      {
        "@context": "https://schema.org",
        "@type": "Organization",
        name: "LAMP Logistics",
        url: "https://traqiq.app",
        logo: "https://traqiq.app/apple-touch-icon.png",
        sameAs: ["https://traqiq.app"],
        contactPoint: {
          "@type": "ContactPoint",
          contactType: "Driver Recruiting",
          telephone: "+1-660-557-2729",
          areaServed: "US",
          availableLanguage: ["English", "Spanish", "Haitian Creole"],
        },
      },
      {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: [
          {
            "@type": "Question",
            name: "Do I need a CDL to drive for LAMP?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "For most LAMP loads, no. Our box trucks are under 26,001 GVWR which doesn't require a CDL — just a regular driver's license. You still need a current DOT physical and a clean driving record.",
            },
          },
          {
            "@type": "Question",
            name: "How fast can I start driving?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "Most drivers go from application to first load in 10–21 days. The timeline depends on how fast your background check, MVR, drug test, and DOT physical come back.",
            },
          },
          {
            "@type": "Question",
            name: "Do I have to own my own truck?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "No. We offer both options. Owner-operators get an 80/20 split (you keep 80% of gross). Company drivers lease one of our trucks and run as an Independent Contractor — guaranteed $1,200/week minimum plus mileage bonuses, no truck payment, no fuel out of pocket.",
            },
          },
          {
            "@type": "Question",
            name: "When and how do I get paid?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "Every Friday. Settlements process Tuesday for the prior week, deposit hits your account Friday. You see a full settlement statement in TraqIQ — no guessing, no missing line items.",
            },
          },
          {
            "@type": "Question",
            name: "What disqualifies me from driving with LAMP?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "Recent license suspension/revocation, DUI in the last 5 years, failed DOT drug or alcohol test, more than 2 moving violations in the past 3 years. Felony convictions are reviewed case-by-case.",
            },
          },
        ],
      },
    ],
    fallbackHtml: `
      <main style="max-width: 720px; margin: 0 auto; padding: 32px 24px; font-family: system-ui, sans-serif; color: #0f172a; background: #ffffff;">
        <h1 style="font-size: 36px; font-weight: 800; line-height: 1.1; margin: 0 0 16px;">Earn $4,000–$6,000 a week. Paid every Friday.</h1>
        <p style="font-size: 18px; line-height: 1.5; margin: 0 0 24px; color: #334155;">
          LAMP Logistics is hiring box truck drivers across the US. Owner-operators get an 80/20 revenue split. Company drivers get a $1,200/week minimum on a lease-on Independent Contractor model — no truck payment, no fuel out of pocket. Most loads do not require a CDL.
        </p>
        <ul style="font-size: 16px; line-height: 1.6; margin: 0 0 32px; padding-left: 20px; color: #1e293b;">
          <li><strong>Owner-operators:</strong> 80/20 split — you keep 80% of gross.</li>
          <li><strong>Company drivers (lease-on):</strong> $1,200/week minimum plus mileage bonuses.</li>
          <li><strong>Weekly pay every Friday.</strong> Settlements process Tuesday; deposit Friday.</li>
          <li><strong>Dedicated dispatcher.</strong> No forced dispatch, no runaround.</li>
          <li><strong>Most loads:</strong> no CDL required (box trucks under 26,001 GVWR).</li>
          <li><strong>From application to first load:</strong> 10–21 days.</li>
        </ul>
        <h2 style="font-size: 24px; font-weight: 700; margin: 32px 0 12px;">How to apply</h2>
        <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">
          Apply online in 5 minutes. After you submit, you'll receive a text with next steps for documents, background check, MVR, DOT physical, and a quick onboarding agreement signed electronically.
        </p>
        <p style="font-size: 16px; margin: 24px 0;">
          <a href="/drive-with-lamp#apply" style="display: inline-block; background: #00b5b8; color: #ffffff; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 700;">Start your application</a>
        </p>
        <h2 style="font-size: 24px; font-weight: 700; margin: 40px 0 12px;">About LAMP Logistics</h2>
        <p style="font-size: 16px; line-height: 1.6; margin: 0 0 8px;">
          MC-1725755 · USDOT 4397421. Box-truck-focused carrier dispatching dedicated and OTR freight nationwide. Drivers are paid weekly through TraqIQ — every settlement is itemized and visible in your driver portal.
        </p>
      </main>
    `.trim(),
  },

  // -----------------------------------------------------------------------
  // /non-cdl-truck-driver-jobs — keyword cluster: "no CDL truck driving jobs"
  // -----------------------------------------------------------------------
  {
    path: "/non-cdl-truck-driver-jobs",
    title: "Non-CDL Truck Driver Jobs — Box Truck, $4,000–$6,000/Week | LAMP Logistics",
    description:
      "Drive a box truck for LAMP Logistics — no CDL required. Our trucks are under 26,001 GVWR, so a regular driver's license is enough. Earn $4,000–$6,000/week, paid every Friday. Apply in 5 minutes.",
    canonicalUrl: "https://traqiq.app/non-cdl-truck-driver-jobs",
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "JobPosting",
        title: "Non-CDL Box Truck Driver — Up to $6,000/Week",
        description:
          "LAMP Logistics is hiring non-CDL box truck drivers. Our trucks are under 26,001 GVWR, so a Class D / regular driver's license is all you need. No CDL school, no Class A required. Earn $4,000–$6,000/week with weekly Friday settlements.",
        datePosted: new Date().toISOString().slice(0, 10),
        validThrough: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10),
        employmentType: "CONTRACTOR",
        hiringOrganization: {
          "@type": "Organization",
          name: "LAMP Logistics",
          sameAs: "https://traqiq.app",
          identifier: { "@type": "PropertyValue", name: "USDOT", value: "4397421" },
        },
        jobLocation: {
          "@type": "Place",
          address: {
            "@type": "PostalAddress",
            addressCountry: "US",
            addressRegion: "TN",
            addressLocality: "Chattanooga",
          },
        },
        baseSalary: {
          "@type": "MonetaryAmount",
          currency: "USD",
          value: { "@type": "QuantitativeValue", minValue: 4000, maxValue: 6000, unitText: "WEEK" },
        },
        qualifications:
          "Valid Class D driver's license (no CDL required), clean MVR, current DOT physical, no DUI in last 5 years, ability to pass DOT drug test.",
        directApply: true,
      },
    ],
    fallbackHtml: `
      <main style="max-width: 720px; margin: 0 auto; padding: 32px 24px; font-family: system-ui, sans-serif; color: #0f172a; background: #ffffff;">
        <h1 style="font-size: 36px; font-weight: 800; line-height: 1.1; margin: 0 0 16px;">Drive a box truck. No CDL required.</h1>
        <p style="font-size: 18px; line-height: 1.5; margin: 0 0 24px; color: #334155;">LAMP Logistics' box trucks are under 26,001 GVWR — Class D (regular driver's license) is enough. No CDL school, no Class A test. Earn $4,000–$6,000 a week, paid every Friday.</p>
        <ul style="font-size: 16px; line-height: 1.6; margin: 0 0 32px; padding-left: 20px;">
          <li>No CDL — Class D license only</li>
          <li>No air brakes endorsement required</li>
          <li>Start driving in 10–21 days from application</li>
          <li>Owner-operator (80/20) or lease-on company driver ($1,200/wk min)</li>
        </ul>
        <p><a href="/non-cdl-truck-driver-jobs#apply" style="display:inline-block;background:#00b5b8;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;">Apply now</a></p>
      </main>
    `.trim(),
  },

  // -----------------------------------------------------------------------
  // /owner-operator-jobs — keyword cluster: "owner operator jobs"
  // -----------------------------------------------------------------------
  {
    path: "/owner-operator-jobs",
    title: "Owner Operator Jobs — 80/20 Split, Box Truck Freight | LAMP Logistics",
    description:
      "Owner-operators at LAMP Logistics keep 80% of gross revenue. Steady box truck freight, dedicated dispatcher, no forced dispatch, weekly Friday settlements. Itemized in TraqIQ. Apply in 5 minutes.",
    canonicalUrl: "https://traqiq.app/owner-operator-jobs",
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "JobPosting",
        title: "Owner Operator — Box Truck — 80/20 Revenue Split",
        description:
          "LAMP Logistics is hiring owner-operators. Bring your truck — we bring the freight and the dispatcher. 80/20 split (you keep 80% of gross), zero forced dispatch, weekly settlements every Friday, itemized in TraqIQ.",
        datePosted: new Date().toISOString().slice(0, 10),
        validThrough: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10),
        employmentType: "CONTRACTOR",
        hiringOrganization: {
          "@type": "Organization",
          name: "LAMP Logistics",
          sameAs: "https://traqiq.app",
          identifier: { "@type": "PropertyValue", name: "USDOT", value: "4397421" },
        },
        jobLocation: {
          "@type": "Place",
          address: {
            "@type": "PostalAddress",
            addressCountry: "US",
            addressRegion: "TN",
            addressLocality: "Chattanooga",
          },
        },
        baseSalary: {
          "@type": "MonetaryAmount",
          currency: "USD",
          value: { "@type": "QuantitativeValue", minValue: 4000, maxValue: 6000, unitText: "WEEK" },
        },
        qualifications:
          "Own (or lease) a box truck under 26,001 GVWR with current registration + commercial insurance, valid driver's license, clean MVR, current DOT physical.",
        directApply: true,
      },
    ],
    fallbackHtml: `
      <main style="max-width: 720px; margin: 0 auto; padding: 32px 24px; font-family: system-ui, sans-serif; color: #0f172a; background: #ffffff;">
        <h1 style="font-size: 36px; font-weight: 800; line-height: 1.1; margin: 0 0 16px;">Owner Operator Jobs — 80/20 Split. Your Truck, Your Rules.</h1>
        <p style="font-size: 18px; line-height: 1.5; margin: 0 0 24px; color: #334155;">Owner-operators at LAMP Logistics keep 80% of gross. We provide the freight, the dispatcher, and the load board. You drive your own truck on your own schedule. No forced dispatch, ever.</p>
        <ul style="font-size: 16px; line-height: 1.6; margin: 0 0 32px; padding-left: 20px;">
          <li>80/20 split — you keep 80% of gross revenue</li>
          <li>No forced dispatch — accept the loads you want</li>
          <li>Weekly pay every Friday, itemized in TraqIQ</li>
          <li>Box-truck-focused (under 26,001 GVWR) — most loads no CDL</li>
        </ul>
        <p><a href="/owner-operator-jobs#apply" style="display:inline-block;background:#00b5b8;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;">Apply now</a></p>
      </main>
    `.trim(),
  },

  // -----------------------------------------------------------------------
  // /box-truck-careers-tennessee — keyword cluster: regional / local
  // -----------------------------------------------------------------------
  {
    path: "/box-truck-careers-tennessee",
    title: "Box Truck Driver Jobs in Tennessee — Chattanooga HQ | LAMP Logistics",
    description:
      "LAMP Logistics is a Chattanooga, TN-based box truck carrier hiring drivers across Tennessee, Georgia, Alabama, and the Southeast. $4,000–$6,000/week, home weekly, paid Friday. Most loads do not require a CDL.",
    canonicalUrl: "https://traqiq.app/box-truck-careers-tennessee",
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "JobPosting",
        title: "Box Truck Driver — Chattanooga TN + Southeast Lanes",
        description:
          "LAMP Logistics is hiring box truck drivers based in or near Chattanooga, Tennessee. Lanes throughout TN, GA, AL, MS, and the broader Southeast. Home-weekly options available. $4,000–$6,000/week, weekly Friday settlements.",
        datePosted: new Date().toISOString().slice(0, 10),
        validThrough: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10),
        employmentType: "CONTRACTOR",
        hiringOrganization: {
          "@type": "Organization",
          name: "LAMP Logistics",
          sameAs: "https://traqiq.app",
          identifier: { "@type": "PropertyValue", name: "USDOT", value: "4397421" },
        },
        jobLocation: {
          "@type": "Place",
          address: {
            "@type": "PostalAddress",
            addressCountry: "US",
            addressRegion: "TN",
            addressLocality: "Chattanooga",
          },
        },
        baseSalary: {
          "@type": "MonetaryAmount",
          currency: "USD",
          value: { "@type": "QuantitativeValue", minValue: 4000, maxValue: 6000, unitText: "WEEK" },
        },
        qualifications:
          "Tennessee or Southeast US residency preferred. Valid driver's license, clean MVR, current DOT physical, no DUI in last 5 years.",
        directApply: true,
      },
    ],
    fallbackHtml: `
      <main style="max-width: 720px; margin: 0 auto; padding: 32px 24px; font-family: system-ui, sans-serif; color: #0f172a; background: #ffffff;">
        <h1 style="font-size: 36px; font-weight: 800; line-height: 1.1; margin: 0 0 16px;">Box Truck Driver Jobs in Tennessee</h1>
        <p style="font-size: 18px; line-height: 1.5; margin: 0 0 24px; color: #334155;">LAMP Logistics is Chattanooga-based and dispatches drivers across Tennessee, Georgia, Alabama, Mississippi, and the broader Southeast. Most local-regional lanes get you home weekly. $4,000–$6,000/week, paid every Friday.</p>
        <ul style="font-size: 16px; line-height: 1.6; margin: 0 0 32px; padding-left: 20px;">
          <li>Chattanooga, TN headquartered</li>
          <li>TN / GA / AL / MS / SC / NC primary lanes</li>
          <li>Home-weekly options on dedicated freight</li>
          <li>Box truck under 26,001 GVWR — most loads no CDL</li>
        </ul>
        <p><a href="/box-truck-careers-tennessee#apply" style="display:inline-block;background:#00b5b8;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;">Apply now</a></p>
      </main>
    `.trim(),
  },

  // -----------------------------------------------------------------------
  // /lease-on-trucking-jobs — keyword cluster: "lease on driving jobs"
  // -----------------------------------------------------------------------
  {
    path: "/lease-on-trucking-jobs",
    title: "Lease-On Trucking Jobs — $1,200/Wk Minimum + Mileage | LAMP Logistics",
    description:
      "Lease one of LAMP Logistics' box trucks on a 1099 Independent Contractor model. $1,200/week minimum guaranteed plus mileage bonuses. No truck payment out of pocket, no fuel cost, no upfront capital. Apply in 5 minutes.",
    canonicalUrl: "https://traqiq.app/lease-on-trucking-jobs",
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "JobPosting",
        title: "Lease-On Box Truck Driver — $1,200/Week Minimum",
        description:
          "LAMP Logistics is hiring lease-on company drivers. Lease one of our box trucks on a 1099 Independent Contractor model with $1,200/week minimum guarantee plus per-mile bonuses on top. Fuel covered, no upfront capital, no truck-payment-out-of-pocket.",
        datePosted: new Date().toISOString().slice(0, 10),
        validThrough: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10),
        employmentType: "CONTRACTOR",
        hiringOrganization: {
          "@type": "Organization",
          name: "LAMP Logistics",
          sameAs: "https://traqiq.app",
          identifier: { "@type": "PropertyValue", name: "USDOT", value: "4397421" },
        },
        jobLocation: {
          "@type": "Place",
          address: {
            "@type": "PostalAddress",
            addressCountry: "US",
            addressRegion: "TN",
            addressLocality: "Chattanooga",
          },
        },
        baseSalary: {
          "@type": "MonetaryAmount",
          currency: "USD",
          value: { "@type": "QuantitativeValue", value: 1200, unitText: "WEEK" },
        },
        qualifications:
          "Valid driver's license, clean MVR, current DOT physical, no DUI in last 5 years, ability to pass DOT drug test and FMCSA Clearinghouse query.",
        directApply: true,
      },
    ],
    fallbackHtml: `
      <main style="max-width: 720px; margin: 0 auto; padding: 32px 24px; font-family: system-ui, sans-serif; color: #0f172a; background: #ffffff;">
        <h1 style="font-size: 36px; font-weight: 800; line-height: 1.1; margin: 0 0 16px;">Lease-On Trucking Jobs — $1,200/Week Minimum Guaranteed</h1>
        <p style="font-size: 18px; line-height: 1.5; margin: 0 0 24px; color: #334155;">Lease one of LAMP Logistics' box trucks on a 1099 Independent Contractor lease-on agreement. $1,200/week minimum guaranteed plus mileage bonuses on top. Fuel is covered. No truck payment out of pocket, no upfront capital.</p>
        <ul style="font-size: 16px; line-height: 1.6; margin: 0 0 32px; padding-left: 20px;">
          <li>$1,200/week minimum guarantee</li>
          <li>Per-mile bonuses paid on top of the minimum</li>
          <li>Fuel covered — no card swipes out of pocket</li>
          <li>No upfront capital required to start</li>
          <li>Box truck (under 26,001 GVWR) — most loads no CDL</li>
        </ul>
        <p><a href="/lease-on-trucking-jobs#apply" style="display:inline-block;background:#00b5b8;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;">Apply now</a></p>
      </main>
    `.trim(),
  },
];

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildSeoHead(cfg: SeoPageConfig): string {
  const title = escapeHtml(cfg.title);
  const desc = escapeHtml(cfg.description);
  const url = escapeHtml(cfg.canonicalUrl);
  const img = escapeHtml(cfg.ogImage || "https://traqiq.app/apple-touch-icon.png");
  const jsonLd = Array.isArray(cfg.jsonLd) ? cfg.jsonLd : [cfg.jsonLd];
  const jsonLdScripts = jsonLd
    .map(
      (obj) =>
        `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, "\\u003c")}</script>`
    )
    .join("\n    ");
  return `
    <meta name="description" content="${desc}" />
    <meta name="robots" content="index,follow,max-snippet:-1,max-image-preview:large,max-video-preview:-1" />
    <link rel="canonical" href="${url}" />

    <meta property="og:type" content="website" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${desc}" />
    <meta property="og:url" content="${url}" />
    <meta property="og:image" content="${img}" />
    <meta property="og:site_name" content="LAMP Logistics" />

    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${desc}" />
    <meta name="twitter:image" content="${img}" />

    ${jsonLdScripts}
  `.trim();
}

/**
 * Register SEO pre-render handlers. Call BEFORE serveStatic() / setupVite().
 */
export function registerSeoPrerender(app: Express, distPath: string): void {
  const indexHtmlPath = path.resolve(distPath, "index.html");
  for (const cfg of SEO_PAGES) {
    app.get(cfg.path, (_req: Request, res: Response, next) => {
      try {
        if (!fs.existsSync(indexHtmlPath)) {
          // Dev mode (Vite middleware) or no build yet — defer.
          return next();
        }
        let html = fs.readFileSync(indexHtmlPath, "utf-8");

        // Replace <title>
        html = html.replace(
          /<title>[^<]*<\/title>/i,
          `<title>${escapeHtml(cfg.title)}</title>`
        );

        // Inject SEO head before </head>
        const seoHead = buildSeoHead(cfg);
        html = html.replace(/<\/head>/i, `${seoHead}\n  </head>`);

        // Inject <noscript> fallback content right after <div id="root">
        // so crawlers that execute zero JS still see the full content.
        const noscript = `<noscript>${cfg.fallbackHtml}</noscript>`;
        html = html.replace(
          /(<div id="root">)/,
          `$1${noscript}`
        );

        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
        res.send(html);
      } catch (err) {
        console.error("[seo-prerender] error for", cfg.path, err);
        next();
      }
    });
  }
}
