import { Router, Request, Response } from 'express';
import { traqiqSopService, SOP_STEPS, TOTAL_STEPS } from './traqiq-sop-service';

const router = Router();

router.get('/steps', (req: Request, res: Response) => {
  res.json({ totalSteps: TOTAL_STEPS, steps: SOP_STEPS });
});

router.post('/:loadId/initialize', async (req: Request, res: Response) => {
  const state = await traqiqSopService.initializeProtocol(req.params.loadId);
  res.json({ success: true, state });
});

router.get('/:loadId/status', (req: Request, res: Response) => {
  const status = traqiqSopService.getProtocolStatus(req.params.loadId);
  if (!status) return res.status(404).json({ success: false, error: 'Not found' });
  res.json({ success: true, ...status });
});

router.post('/:loadId/advance', async (req: Request, res: Response) => {
  const state = await traqiqSopService.advanceStep(req.params.loadId, 'manual', req.body.notes);
  if (!state) return res.status(404).json({ success: false, error: 'Not found' });
  res.json({ success: true, ...traqiqSopService.getProtocolStatus(req.params.loadId) });
});

router.post('/:loadId/confirm-driver', async (req: Request, res: Response) => {
  const { driverId } = req.body;
  if (!driverId) return res.status(400).json({ success: false, error: 'driverId required' });
  const state = await traqiqSopService.confirmDriver(req.params.loadId, driverId);
  if (!state) return res.status(400).json({ success: false, error: 'Cannot confirm at current step' });
  res.json({ success: true, ...traqiqSopService.getProtocolStatus(req.params.loadId) });
});

router.post('/:loadId/location', async (req: Request, res: Response) => {
  const { driverId, lat, lng } = req.body;
  if (!driverId || lat === undefined || lng === undefined) {
    return res.status(400).json({ success: false, error: 'driverId, lat, lng required' });
  }
  await traqiqSopService.processLocationUpdate(req.params.loadId, driverId, lat, lng);
  res.json({ success: true, ...traqiqSopService.getProtocolStatus(req.params.loadId) });
});

router.post('/:loadId/manual-override', async (req: Request, res: Response) => {
  const { action } = req.body;
  if (!['confirm', 'skip'].includes(action)) {
    return res.status(400).json({ success: false, error: 'action must be confirm or skip' });
  }
  const state = await traqiqSopService.manualOverride(req.params.loadId, action);
  if (!state) return res.status(404).json({ success: false, error: 'Not found' });
  res.json({ success: true, ...traqiqSopService.getProtocolStatus(req.params.loadId) });
});

router.post('/:loadId/document', async (req: Request, res: Response) => {
  const { docType } = req.body;
  if (!['bol', 'freight_photos', 'pod'].includes(docType)) {
    return res.status(400).json({ success: false, error: 'Invalid docType' });
  }
  await traqiqSopService.handleDocumentUpload(req.params.loadId, docType);
  res.json({ success: true, ...traqiqSopService.getProtocolStatus(req.params.loadId) });
});

router.get('/active', (req: Request, res: Response) => {
  const protocols = traqiqSopService.getAllActiveProtocols();
  res.json({ success: true, count: protocols.length, protocols });
});

export default router;
