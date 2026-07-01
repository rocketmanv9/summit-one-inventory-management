/**
 * POST /api/inventory/purchasing/documents/upload
 *
 * Manually attach a receipt/invoice/document (PDF or image) to a purchase order.
 * The file is extracted and stored in the receipt repository as a review
 * suggestion; reconciling its numbers onto the PO is an explicit follow-up.
 *
 * Body: { po_id, file_data (base64 data URL), file_name, doc_type? }
 */
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';
import { ingestUploadedDocument } from '@/lib/documents/store';
import { PURCHASE_DOC_TYPES } from '@/lib/documents/types';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';
const MAX_BYTES = 15 * 1024 * 1024;

const UploadSchema = z.object({
  po_id: z.string().uuid(),
  file_data: z.string().min(1),
  file_name: z.string().min(1).max(255),
  doc_type: z.enum(PURCHASE_DOC_TYPES as [string, ...string[]]).optional(),
});

export const POST = createSessionWriteRoute(
  async ({ req, ctx, supabase, log, idempotencyKey }) => {
    const body = UploadSchema.parse(await req.json());

    const match = body.file_data.match(/^data:([\w/+.-]+);base64,(.+)$/);
    if (!match) throw AppError.badRequest('file_data must be a base64 data URL (data:<mime>;base64,<...>)');
    const contentType = match[1];
    const bytes = Buffer.from(match[2], 'base64');
    if (bytes.length === 0) throw AppError.badRequest('Uploaded file is empty.');
    if (bytes.length > MAX_BYTES) throw AppError.badRequest('File exceeds 15MB limit.');

    const persisted = await ingestUploadedDocument({
      db: supabase,
      tenantId: ctx.tenantId!,
      poId: body.po_id,
      fileName: body.file_name,
      contentType,
      bytes: new Uint8Array(bytes),
      docTypeHint: body.doc_type,
    });

    log.info('purchase_document.uploaded', { po_id: body.po_id, document_id: persisted.id, doc_type: persisted.doc_type });

    return {
      data: persisted,
      status: 201,
      events: [
        {
          event_name: 'purchase_document.uploaded',
          payload: { purchase_order_id: body.po_id, document_id: persisted.id, doc_type: persisted.doc_type },
          last_event_id: idempotencyKey,
        },
      ],
    };
  },
  { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/purchasing/documents/upload' },
);
