import fs from 'node:fs';
import path from 'node:path';

if (!fs.existsSync('package.json') || !fs.existsSync('src/App.tsx')) {
  throw new Error('Run this from the project folder containing package.json.');
}

const changed = [];

// Keep existing bookings, calendar identities and backend secrets working.
// These are internal identifiers, not visible branding.
const preserved = [
  'stayola-guest-bookings-v1',
  'stayolaEvent',
  'ANTHROPIC_API_KEY_STAYOLA',
  '@stayola',
  'stayola_booking_revision',
  'stayola_revision',
];

function renameText(source) {
  const saved = [];

  function protect(value) {
    const marker = `__PRESERVED_BRAND_VALUE_${saved.length}__`;
    saved.push(value);
    return marker;
  }

  let result = source;

  // Existing links must keep pointing to their actual addresses.
  result = result.replace(
    /https?:\/\/[^\s"'<>`]+/g,
    protect,
  );

  for (const value of preserved) {
    result = result.split(value).join(protect(value));
  }

  result = result.replace(/stayola|bookingguard/gi, match =>
    match === match.toLowerCase() ? 'allthatbook' : 'Allthatbook',
  );

  // Replace the old "s" logo initial.
  result = result.replace(
    /(<span\b[^>]*className=["']brand-icon["'][^>]*>)\s*s\s*(<\/span>)/gi,
    '$1a$2',
  );

  // Replace the workspace avatar initial.
  result = result.replace(
    /<span>S<\/span>/g,
    '<span>A</span>',
  );

  // Capitalise the visible brand while keeping filenames lowercase.
  result = result.replace(
    /(<span\b[^>]*className=["']brand-icon["'][^>]*>\s*a\s*<\/span>\s*)allthatbook/g,
    '$1Allthatbook',
  );

  result = result.replace(
    /(<span\b[^>]*className=["']footer-brand["'][^>]*>\s*)allthatbook/g,
    '$1Allthatbook',
  );

  result = result.replace(
    /__PRESERVED_BRAND_VALUE_(\d+)__/g,
    (_, index) => saved[Number(index)],
  );

  return result;
}

function update(file, transform = renameText) {
  if (!fs.existsSync(file)) return;

  const original = fs.readFileSync(file, 'utf8');
  const updated = transform(original);

  if (updated !== original) {
    fs.writeFileSync(file, updated, 'utf8');
    changed.push(file);
  }
}

function walk(directory) {
  if (!fs.existsSync(directory)) return;

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;

    const file = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      walk(file);
    } else if (/\.(tsx?|jsx?|css|html|svg|json|webmanifest)$/i.test(file)) {
      update(file);
    }
  }
}

walk('src');
walk('public');
walk('supabase/functions');

update('index.html');
update('README.md');
update('SETUP.md');

update('package.json', source => {
  const data = JSON.parse(source);
  data.name = 'allthatbook';
  return JSON.stringify(data, null, 2) + '\n';
});

update('package-lock.json', source => {
  const data = JSON.parse(source);
  data.name = 'allthatbook';

  if (data.packages?.['']) {
    data.packages[''].name = 'allthatbook';
  }

  return JSON.stringify(data, null, 2) + '\n';
});

// Replace the browser-tab icon.
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="18" fill="#254b3b"/>
  <text x="32" y="46" text-anchor="middle"
    font-family="Arial,sans-serif" font-size="48"
    font-weight="700" fill="#e9f1c7">a</text>
</svg>
`;

fs.mkdirSync('public', { recursive: true });

if (
  !fs.existsSync('public/favicon.svg') ||
  fs.readFileSync('public/favicon.svg', 'utf8') !== favicon
) {
  fs.writeFileSync('public/favicon.svg', favicon);
  changed.push('public/favicon.svg');
}

// Ensure the longer name fits the existing sidebar.
const cssFile = 'src/styles.css';
const marker = '/* Allthatbook brand sizing */';

if (fs.existsSync(cssFile)) {
  const css = fs.readFileSync(cssFile, 'utf8');

  if (!css.includes(marker)) {
    fs.appendFileSync(cssFile, `
${marker}
.brand {
  font-size: 24px;
  letter-spacing: -1px;
  white-space: nowrap;
}
.brand-icon {
  flex-shrink: 0;
}
footer .footer-brand {
  font-size: 18px;
  white-space: nowrap;
}
@media (min-width: 651px) and (max-width: 1150px) {
  .sidebar .brand {
    font-size: 19px;
    letter-spacing: -0.8px;
    padding-left: 0;
  }
  .sidebar .brand-icon {
    width: 27px;
    height: 31px;
    margin-right: 6px;
    font-size: 25px;
  }
}
`);
    changed.push(cssFile);
  }
}

console.log('Renamed the website to Allthatbook.');
console.log([...new Set(changed)].join('\n'));
console.log('\nExisting booking storage and calendar identifiers preserved.');