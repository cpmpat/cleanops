import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

/**
 * In-app manual ("Nápověda").
 *
 * The manual is written outside the app and exported as one HTML file with a
 * language tab per locale. `importBundle` splits that file into one row per
 * language so the app can serve the reader's own language without shipping
 * three languages down the wire.
 *
 * Stored HTML is a complete document and is rendered in an iframe — the
 * manual styles `body`, `h2`, `table`, and injecting that into the page would
 * repaint the entire app.
 */

const SUPPORTED = ['cs', 'en', 'ru', 'uk'] as const;
type HelpLocale = (typeof SUPPORTED)[number];

/** Czech is the source language; anything missing falls back to it. */
const FALLBACK: HelpLocale = 'cs';

const META_SELECT = {
  locale: true,
  title: true,
  version: true,
  publishedAt: true,
  publishedBy: { select: { id: true, name: true, email: true } },
} as const;

@Injectable()
export class HelpService {
  private readonly logger = new Logger(HelpService.name);

  constructor(private prisma: PrismaService) {}

  // ─── Reading ───────────────────────────────────────────────────────────────

  /** The document to show this user, in their language or Czech. */
  async forUser(tenantId: string, userId: string, requested?: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: { language: true },
    });

    const wanted = normaliseLocale(requested ?? user?.language ?? FALLBACK);
    const docs = await this.prisma.helpDoc.findMany({ where: { tenantId } });
    if (!docs.length) throw new NotFoundException('No manual has been uploaded yet');

    const doc = docs.find((d) => d.locale === wanted)
      ?? docs.find((d) => d.locale === FALLBACK);
    if (!doc) throw new NotFoundException('No manual in a language you can read');

    return {
      locale: doc.locale,
      requestedLocale: wanted,
      /** True when we had to fall back — the UI says so instead of pretending. */
      isFallback: doc.locale !== wanted,
      title: doc.title,
      html: doc.html,
      version: doc.version,
      publishedAt: doc.publishedAt,
      availableLocales: docs.map((d) => d.locale).sort(),
    };
  }

  /**
   * Version only — a few bytes. Drives the "new manual" dot without pulling
   * a multi-megabyte document on every screen load.
   */
  async metaForUser(tenantId: string, userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: { language: true },
    });
    const wanted = normaliseLocale(user?.language ?? FALLBACK);

    const docs = await this.prisma.helpDoc.findMany({
      where: { tenantId },
      select: { locale: true, version: true, publishedAt: true },
    });
    if (!docs.length) return { exists: false, locale: null, version: 0, publishedAt: null };

    const doc = docs.find((d) => d.locale === wanted) ?? docs.find((d) => d.locale === FALLBACK);
    return {
      exists: !!doc,
      locale: doc?.locale ?? null,
      version: doc?.version ?? 0,
      publishedAt: doc?.publishedAt ?? null,
      availableLocales: docs.map((d) => d.locale).sort(),
    };
  }

  // ─── Publishing (manager) ──────────────────────────────────────────────────

  async list(tenantId: string) {
    const docs = await this.prisma.helpDoc.findMany({
      where: { tenantId },
      select: { ...META_SELECT, html: true },
      orderBy: { locale: 'asc' },
    });
    // Send the size, not the document — this list is an overview screen.
    return docs.map(({ html, ...rest }) => ({ ...rest, bytes: Buffer.byteLength(html, 'utf8') }));
  }

  async publish(
    tenantId: string,
    userId: string,
    locale: string,
    html: string,
    title?: string,
  ) {
    const normalised = normaliseLocale(locale);
    if (!SUPPORTED.includes(normalised)) {
      throw new BadRequestException(`Unsupported language: ${locale}`);
    }
    if (!html?.trim()) throw new BadRequestException('The document is empty');

    const document = wrapAsDocument(sanitise(html), title);

    const existing = await this.prisma.helpDoc.findUnique({
      where: { tenantId_locale: { tenantId, locale: normalised } },
      select: { id: true, version: true },
    });

    const doc = existing
      ? await this.prisma.helpDoc.update({
          where: { id: existing.id },
          data: {
            html: document,
            title: title ?? undefined,
            version: existing.version + 1,
            publishedAt: new Date(),
            publishedById: userId,
          },
          select: META_SELECT,
        })
      : await this.prisma.helpDoc.create({
          data: {
            tenantId,
            locale: normalised,
            html: document,
            title,
            publishedById: userId,
          },
          select: META_SELECT,
        });

    this.logger.log(`Manual published: ${normalised} v${doc.version}`);
    return doc;
  }

  /**
   * Take the exported multi-language HTML and store one document per language.
   *
   * The export marks each language with `<div class="pane" data-l="cs">`. We
   * slice on those markers rather than parsing the whole tree — the panes are
   * full of nested divs and a lazy regex would stop at the first `</div>`.
   */
  async importBundle(tenantId: string, userId: string, html: string) {
    if (!html?.trim()) throw new BadRequestException('The file is empty');

    const styles = (html.match(/<style[\s\S]*?<\/style>/gi) ?? []).join('\n');
    const openTag = /<div[^>]*class="[^"]*\bpane\b[^"]*"[^>]*data-l="([a-z]{2})"[^>]*>/gi;

    const marks: { locale: string; contentStart: number; tagStart: number }[] = [];
    let match: RegExpExecArray | null;
    while ((match = openTag.exec(html)) !== null) {
      marks.push({
        locale: match[1].toLowerCase(),
        tagStart: match.index,
        contentStart: match.index + match[0].length,
      });
    }

    if (!marks.length) {
      throw new BadRequestException(
        'No language sections found. Expected <div class="pane" data-l="cs">…',
      );
    }

    const endOfLast = (() => {
      const idx = html.lastIndexOf('</main>');
      return idx > marks[marks.length - 1].contentStart ? idx : html.length;
    })();

    const results = [];
    for (let i = 0; i < marks.length; i++) {
      const { locale, contentStart } = marks[i];
      const end = i + 1 < marks.length ? marks[i + 1].tagStart : endOfLast;

      // Drop the pane's own closing tag, which the slice picked up.
      const body = html.slice(contentStart, end).trimEnd().replace(/<\/div>\s*$/i, '');
      const normalised = normaliseLocale(locale);
      if (!SUPPORTED.includes(normalised)) {
        this.logger.warn(`Skipping unsupported language in bundle: ${locale}`);
        continue;
      }

      const doc = await this.publish(
        tenantId,
        userId,
        normalised,
        `${styles}\n${body}`,
        extractTitle(body),
      );
      results.push({ ...doc, bytes: Buffer.byteLength(body, 'utf8') });
    }

    if (!results.length) {
      throw new BadRequestException('The file contained no language we support');
    }
    return { imported: results.map((r) => r.locale), docs: results };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normaliseLocale(value: string): HelpLocale {
  const v = (value ?? '').toLowerCase().slice(0, 2);
  if (v === 'ua') return 'uk'; // the export sometimes writes the country code
  return (SUPPORTED as readonly string[]).includes(v) ? (v as HelpLocale) : FALLBACK;
}

/**
 * Conservative strip. The uploader is a manager, so this guards against a
 * copy-pasted tracker or an editor's leftovers, not against an attacker with
 * an account. The iframe (no allow-scripts) is the actual boundary.
 */
function sanitise(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<(object|embed|form)[\s\S]*?<\/\1>/gi, '')
    .replace(/<meta[^>]+http-equiv=["']?refresh[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"');
}

/** Store a complete document — it is rendered in an isolated iframe. */
function wrapAsDocument(inner: string, title?: string): string {
  if (/<html[\s>]/i.test(inner)) return inner;
  return [
    '<!doctype html>',
    '<html lang="cs"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    title ? `<title>${escapeHtml(title)}</title>` : '',
    '<base target="_blank">',
    '</head><body>',
    inner,
    '</body></html>',
  ].join('\n');
}

function extractTitle(html: string): string | undefined {
  const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return m ? m[1].replace(/<[^>]+>/g, '').trim().slice(0, 200) : undefined;
}

function escapeHtml(v: string): string {
  return v.replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
  );
}
