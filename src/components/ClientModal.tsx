import { useState } from 'react';
import { uid } from '../lib/format';
import type { AppData, Client, Contact } from '../types';
import { ColorPicker } from './ColorPicker';
import { useToast } from './Toast';
import { Field, IconPlus, Modal } from './ui';
import { t } from '../lib/i18n';

type Update = (fn: (d: AppData) => AppData) => void;

const blank = (): Contact => ({ id: uid(), name: '', role: '', email: '', phone: '', notes: '' });

/** Edit a client: name, colour, notes, and the people you deal with there. */
export function ClientModal({ client, update, onClose }: { client: Client; update: Update; onClose: () => void }) {
  const [f, setF] = useState<Client>({ ...client, contacts: client.contacts.length ? client.contacts : [] });
  const [openId, setOpenId] = useState<string | null>(null);
  const toast = useToast();
  const setContact = (id: string, patch: Partial<Contact>) =>
    setF({ ...f, contacts: f.contacts.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  const addContact = () => {
    const c = blank();
    setF({ ...f, contacts: [...f.contacts, c] });
    setOpenId(c.id);
  };
  const save = () => {
    const name = f.name.trim();
    if (!name) return;
    const contacts = f.contacts
      .map((c) => ({ ...c, name: c.name.trim(), role: c.role.trim(), email: c.email.trim(), phone: c.phone.trim() }))
      .filter((c) => c.name || c.email || c.phone);
    update((d) => ({ ...d, clients: d.clients.map((c) => (c.id === client.id ? { ...c, name, color: f.color, notes: f.notes, contacts } : c)) }));
    toast(<>{t('Client saved:')} <b>{name}</b></>, { tone: 'success' });
    onClose();
  };

  return (
    <Modal title={t('Client')} onClose={onClose}>
      <form className="section" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <div className="row" style={{ gap: '0.625rem', flexWrap: 'nowrap', alignItems: 'flex-end' }}>
          <ColorPicker value={f.color} onChange={(color) => setF({ ...f, color })} label={t('Client colour')} />
          <div style={{ flex: 1 }}>
            <Field label={t('Name')}><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          </div>
        </div>
        <Field label={t('Notes')}>
          <textarea className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder={t('How they like to work, payment habits, billing address…')} />
        </Field>

        <div className="contacts-edit">
          <div className="checklist-head">
            <span className="field-label">{t('Contacts')}</span>
            <span className="small">{f.contacts.length || t('None yet')}</span>
          </div>
          {f.contacts.map((c) =>
            openId === c.id ? (
              <div className="contact-form" key={c.id}>
                <div className="form-grid">
                  <Field label={t('Name')}><input className="input" autoFocus value={c.name} onChange={(e) => setContact(c.id, { name: e.target.value })} placeholder="Sarah Martin" /></Field>
                  <Field label={t('Role')}><input className="input" value={c.role} onChange={(e) => setContact(c.id, { role: e.target.value })} placeholder={t('Owner, CTO, accounting…')} /></Field>
                  <Field label={t('Email')}><input className="input" type="email" value={c.email} onChange={(e) => setContact(c.id, { email: e.target.value })} /></Field>
                  <Field label={t('Phone')}><input className="input" type="tel" value={c.phone} onChange={(e) => setContact(c.id, { phone: e.target.value })} /></Field>
                </div>
                <Field label={t('Notes about this person')}>
                  <textarea className="input" value={c.notes} onChange={(e) => setContact(c.id, { notes: e.target.value })} placeholder={t('Decision maker, prefers WhatsApp, met at…')} />
                </Field>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <button type="button" className="btn sm danger" onClick={() => { setF({ ...f, contacts: f.contacts.filter((x) => x.id !== c.id) }); setOpenId(null); }}>{t('Remove')}</button>
                  <button type="button" className="btn sm outline" onClick={() => setOpenId(null)}>{t('Done')}</button>
                </div>
              </div>
            ) : (
              <button type="button" className="contact-row" key={c.id} onClick={() => setOpenId(c.id)}>
                <span className="contact-avatar">{(c.name || c.email || '?').charAt(0).toUpperCase()}</span>
                <span className="contact-main">
                  <b className="ellipsis">{c.name || c.email || c.phone}</b>
                  <span className="small ellipsis">{[c.role, c.email, c.phone].filter(Boolean).join(' · ') || t('Add details')}</span>
                </span>
                <span className="small">{t('Edit')}</span>
              </button>
            ),
          )}
          <button type="button" className="add-link" onClick={addContact}><IconPlus size={12} /> {t('Add a contact')}</button>
        </div>

        <div className="modal-foot">
          <span />
          <div className="row" style={{ gap: '0.5rem' }}>
            <button className="btn sm ghost" type="button" onClick={onClose}>{t('Cancel')}</button>
            <button className="btn sm" type="submit" disabled={!f.name.trim()}>{t('Save')}</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

/** Read-only list of a client's contacts, with email and phone links. */
export function ContactList({ client, onEdit }: { client: Client; onEdit: () => void }) {
  return (
    <div className="contact-list">
      {client.contacts.map((c) => (
        <div className="contact-card" key={c.id}>
          <span className="contact-avatar">{(c.name || c.email || '?').charAt(0).toUpperCase()}</span>
          <div className="contact-main">
            <b className="ellipsis">{c.name || c.email}</b>
            {c.role && <span className="small ellipsis">{c.role}</span>}
            <span className="contact-links">
              {c.email && <a href={`mailto:${c.email}`}>{c.email}</a>}
              {c.phone && <a href={`tel:${c.phone.replace(/\s+/g, '')}`}>{c.phone}</a>}
            </span>
            {c.notes && <p className="contact-notes">{c.notes}</p>}
          </div>
        </div>
      ))}
      {client.contacts.length === 0 && (
        <div className="empty">{t('No contacts for {name} yet.', { name: client.name })} <button className="link-btn" onClick={onEdit}>{t('Add one')}</button></div>
      )}
    </div>
  );
}
