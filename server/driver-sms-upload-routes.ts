import { Router, Request, Response } from 'express';
import { driverSMSUploadService } from './driver-sms-upload-service';
import { randomUUID } from 'crypto';

const router = Router();

router.post('/incoming', async (req: Request, res: Response) => {
  const result = await driverSMSUploadService.processIncomingSMS({
    From: req.body.From,
    Body: req.body.Body || '',
    NumMedia: req.body.NumMedia || '0',
    MediaUrl0: req.body.MediaUrl0,
    MediaUrl1: req.body.MediaUrl1,
    MediaContentType0: req.body.MediaContentType0,
    MessageSid: req.body.MessageSid,
  });

  const reply = result.success ? `✅ ${result.message}` : `❌ ${result.error}`;
  res.set('Content-Type', 'text/xml');
  res.send(driverSMSUploadService.generateAutoReply(result.success, reply));
});

router.get('/messages/:loadId', (req: Request, res: Response) => {
  const messages = driverSMSUploadService.getLoadMessages(req.params.loadId);
  res.json(messages);
});

router.get('/load/:loadId/messages', (req: Request, res: Response) => {
  const messages = driverSMSUploadService.getLoadMessages(req.params.loadId);
  res.json({ success: true, loadId: req.params.loadId, count: messages.length, messages });
});

router.get('/load/:loadId/documents', (req: Request, res: Response) => {
  const docs = driverSMSUploadService.getLoadDocuments(req.params.loadId);
  res.json({ success: true, loadId: req.params.loadId, count: docs.length, documents: docs });
});

router.post('/send', async (req: Request, res: Response) => {
  const { loadId, body } = req.body;
  if (!loadId || !body) {
    return res.status(400).json({ success: false, error: 'loadId and body required' });
  }
  const success = await driverSMSUploadService.sendLoadMessage(loadId, '', body);
  res.json({ success, message: 'Message queued' });
});

router.post('/test', async (req: Request, res: Response) => {
  const { loadId, phone, body, numMedia } = req.body;
  
  const message = {
    id: randomUUID(),
    loadId,
    driverPhone: phone || '+15551234567',
    direction: 'inbound' as const,
    body: body || 'Test message',
    mediaUrls: [],
    mediaTypes: [],
    docType: 'freight_photos' as const,
    timestamp: new Date(),
  };
  
  (driverSMSUploadService as any).addMessageToLoad(loadId, message);
  
  res.json({ success: true, message: 'Test message added', loadId });
});

export default router;
