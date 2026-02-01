import { Router, Request, Response } from 'express';
import { driverSMSUploadService } from './driver-sms-upload-service';

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

router.get('/load/:loadId/messages', (req: Request, res: Response) => {
  const messages = driverSMSUploadService.getLoadMessages(req.params.loadId);
  res.json({ success: true, loadId: req.params.loadId, count: messages.length, messages });
});

router.get('/load/:loadId/documents', (req: Request, res: Response) => {
  const docs = driverSMSUploadService.getLoadDocuments(req.params.loadId);
  res.json({ success: true, loadId: req.params.loadId, count: docs.length, documents: docs });
});

export default router;
