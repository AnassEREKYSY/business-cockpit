import { useEffect, useState } from 'react';
import { DatePicker } from './Calendar';
import { Select } from './Select';
import { Field, Seg } from './ui';
import { allTxns } from '../lib/finance';
import { fmtDate, isoDate, money, pct } from '../lib/format';
import { t } from '../lib/i18n';
import { TAX_PRESETS, acreEnd, rateOn, taxesOn } from '../lib/tax';
import { firstEndFor } from '../lib/urssaf';
import type { AppData, TaxSettings } from '../types';

/* ---------------- Taxes ---------------- */

// A function, not a constant: the labels follow the current language.
const activityOptions = () => [
  ...(Object.keys(TAX_PRESETS) as (keyof typeof TAX_PRESETS)[]).map((k) => ({ value: k as TaxSettings['activity'], label: t(TAX_PRESETS[k].label) })),
  { value: 'custom' as const, label: t('Custom rates') },
];

function RateInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const [raw, setRaw] = useState(String(value));
  useEffect(() => setRaw(String(value)), [value]);
  return (
    <Field label={label}>
      <span className="pct-input">
        <input
          className="input"
          inputMode="decimal"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          onBlur={() => {
            const n = Number(raw.replace(',', '.'));
            if (Number.isFinite(n) && n >= 0 && n <= 100) onChange(Math.round(n * 1000) / 1000);
            else setRaw(String(value));
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <span>%</span>
      </span>
    </Field>
  );
}

export function TaxCard({ tax, currency, data, onChange }: { tax: TaxSettings; currency: string; data: AppData; onChange: (t: TaxSettings) => void }) {
  const today = isoDate();
  const now = rateOn(tax, today);
  const after = { ...tax, acreUntil: '' };
  const later = rateOn(after, today);
  const year = String(new Date().getFullYear());
  const yearTax = taxesOn(allTxns(data).filter((e) => e.date.startsWith(year)), tax);
  const set = (patch: Partial<TaxSettings>) => onChange({ ...tax, ...patch, activity: patch.activity ?? ('social' in patch || 'acre' in patch || 'cfp' in patch || 'vl' in patch ? 'custom' : tax.activity) });
  const pickActivity = (activity: TaxSettings['activity']) => {
    if (activity === 'custom') return onChange({ ...tax, activity });
    const p = TAX_PRESETS[activity];
    onChange({ ...tax, activity, social: p.social, acre: p.acre, cfp: p.cfp, vl: tax.vl ? p.vl : 0 });
  };
  return (
    <div className="card" style={{ gap: '0.875rem' }}>
      <div className="head">
        <div>
          <div className="card-title">{t('Taxes · micro-entreprise')}</div>
          <div className="small">{t('Used to show gross and net revenue everywhere. Rates are 2026 values: check them each January, and when ACRE ends.')}</div>
        </div>
        <div className="tax-now">
          <span className="small">{t('Today')}</span>
          <b>{pct(now.total)}</b>
          {now.acre ? <span className="pay-chip waiting">ACRE</span> : null}
        </div>
      </div>
      <div className="form-grid">
        <Field label={t('Activity')}>
          <Select value={tax.activity} onChange={pickActivity} options={activityOptions()} ariaLabel={t('Activity')} />
        </Field>
        <Field label={t('Business started')}>
          <DatePicker value={tax.start} onChange={(start) => onChange({ ...tax, start, acreUntil: tax.acreUntil ? acreEnd(start) || tax.acreUntil : '' })} placeholder={t('Unknown')} ariaLabel={t('Business started')} />
        </Field>
        <Field label={t('ACRE until')}>
          <DatePicker value={tax.acreUntil} onChange={(acreUntil) => onChange({ ...tax, acreUntil })} placeholder={t('No ACRE')} ariaLabel={t('ACRE until')} />
        </Field>
        <Field label={t('Declared and paid')}>
          <Seg label={t('Declared and paid')} value={tax.period} onChange={(period) => onChange({ ...tax, period, firstEnd: '' })} options={[['quarter', t('Every 3 months')], ['month', t('Every month')]]} />
        </Field>
        <Field label={t('First declaration covers until')}>
          <DatePicker value={tax.firstEnd} onChange={(firstEnd) => onChange({ ...tax, firstEnd })} min={tax.start || undefined} placeholder={tax.start ? t('Auto: {date}', { date: fmtDate(firstEndFor(tax.start, tax.period)) }) : t('Auto')} ariaLabel={t('First declaration covers until')} />
        </Field>
        <Field label={t('Versement libératoire')}>
          <Seg label={t('Versement libératoire')} value={tax.vl > 0 ? 'yes' : 'no'} onChange={(v) => set({ vl: v === 'yes' ? (tax.activity !== 'custom' ? TAX_PRESETS[tax.activity].vl : 1.7) : 0, activity: tax.activity })} options={[['yes', t('Yes')], ['no', t('No')]]} />
        </Field>
      </div>
      <div className="form-grid">
        <RateInput label={t('Social contributions')} value={tax.social} onChange={(social) => set({ social })} />
        <RateInput label={t('Social, during ACRE')} value={tax.acre} onChange={(acre) => set({ acre })} />
        <RateInput label={t('Training (CFP)')} value={tax.cfp} onChange={(cfp) => set({ cfp })} />
        <RateInput label={t('Income tax (VL)')} value={tax.vl} onChange={(vl) => set({ vl })} />
      </div>
      <div className="tax-summary">
        <div>
          <span className="small">{now.acre ? t('Now, with ACRE (until {date})', { date: fmtDate(tax.acreUntil) }) : t('Now')}</span>
          <b>{pct(now.total)}</b>
          <span className="small">{t('{social} URSSAF + {cfp} CFP', { social: pct(now.social), cfp: pct(now.cfp) })}{tax.vl ? ' + ' + t('{p} income tax', { p: pct(now.vl) }) : ''}</span>
        </div>
        {now.acre && (
          <div>
            <span className="small">{t('After ACRE')}</span>
            <b>{pct(later.total)}</b>
            <span className="small">{t('{social} URSSAF + {cfp} CFP', { social: pct(later.social), cfp: pct(later.cfp) })}{tax.vl ? ' + ' + t('{p} income tax', { p: pct(later.vl) }) : ''}</span>
          </div>
        )}
        <div>
          <span className="small">{t('This year so far')}</span>
          <b>{money(yearTax.total, currency)}</b>
          <span className="small">{t('on {gross} gross · {net} net', { gross: money(yearTax.gross, currency), net: money(yearTax.net, currency) })}</span>
        </div>
      </div>
      <div className="small">{t('Trading, investment and real estate income are not business turnover: no contributions are counted on them.')}</div>
    </div>
  );
}

