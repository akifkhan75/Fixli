import React from 'react';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { renderWithStore } from '../testSupport/render';
import * as api from '../services/api';
import { StageCard } from '../components/projects/StageCard';
import { BidForm } from '../components/projects/BidForm';
import { BidCard } from '../components/projects/BidCard';
import { Materials } from '../components/projects/Materials';
import { Visits } from '../components/projects/Visits';
import { ProjectCard } from '../components/projects/ProjectCard';

jest.mock('../hooks/useI18n', () => {
  const i18n = jest.requireActual('../i18n');
  return { useI18n: () => ({ t: i18n.t, tn: i18n.tn, locale: 'en', isRtl: false }) };
});
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() } }));
jest.mock('../services/api', () => ({
  ...jest.requireActual('../services/api'),
  fundStage: jest.fn(), startStage: jest.fn(), submitStage: jest.fn(), approveStage: jest.fn(), requestStageChanges: jest.fn(),
  markStagePaid: jest.fn(), disputeStage: jest.fn(), addMaterial: jest.fn(), setMaterialReady: jest.fn(), removeMaterial: jest.fn(),
  addVisit: jest.fn(), updateVisit: jest.fn(),
}));
const mocked = api as jest.Mocked<typeof api>;

const stage = (over: Partial<api.ProjectStage> = {}): api.ProjectStage => ({
  id: 's1', position: 0, title: 'Wiring', amount: 5_000_000, status: 'PENDING', submittedNote: null, changesNote: null, submittedAt: null, evidence: [], payments: [], ...over,
});
const project = (over: Partial<api.ProjectView> = {}): api.ProjectView => ({
  id: 'p1', viewer: 'customer', title: 'New house wiring', description: '', status: 'IN_PROGRESS', workType: 'NEW_BUILD', propertyType: 'HOUSE', paymentMode: 'ESCROW',
  cardAvailable: true, currency: 'PKR', budgetMin: null, budgetMax: null, startWhen: 'ASAP', agreedAmount: 5_000_000, area: 'Gulshan', city: 'Karachi', location: 'House 1', distanceKm: null,
  createdAt: '2027-01-01T00:00:00Z', category: { id: 'c', name: 'ELECTRICAL', iconName: 'flash' }, customer: { id: 'u', name: 'Sara' }, awardedWorker: null,
  suggestedMilestones: null, photos: [], audioUrl: null, audioTranscript: null, milestones: [], materials: [], visits: [], reviews: [], myBid: null, ...over,
});
const card = (p: api.ProjectView, s: api.ProjectStage, onChanged = jest.fn()) => renderWithStore(<StageCard project={p} stage={s} current onChanged={onChanged} index={0} />);

describe('project stages', () => {
  beforeEach(() => jest.clearAllMocks());

  it('a card customer pays first, on the provider page', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
    mocked.fundStage.mockResolvedValue({ checkoutUrl: 'https://pay.example/1' });
    const view = card(project(), stage());
    await act(async () => { fireEvent.press(view.getByText(/^Pay /)); });
    expect(mocked.fundStage).toHaveBeenCalledWith('s1');
    expect(open).toHaveBeenCalledWith('https://pay.example/1');
  });

  it('a card professional cannot start before the money is held', () => {
    const view = card(project({ viewer: 'hired' }), stage());
    expect(view.queryByText('Start this stage')).toBeNull();
    expect(view.getByText(/Waiting for the customer's payment/)).toBeTruthy();
  });

  it('approving asks first, and only the confirmation releases money', async () => {
    const view = card(project(), stage({ status: 'SUBMITTED' }));
    fireEvent.press(view.getByText('Approve this stage'));
    expect(mocked.approveStage).not.toHaveBeenCalled();
    expect(view.getByText(/Approve and release/)).toBeTruthy();
    await act(async () => { fireEvent.press(view.getByText('Approve this stage')); });
    expect(mocked.approveStage).toHaveBeenCalledWith('s1');
  });

  it('the customer can send work back with a reason', async () => {
    const view = card(project(), stage({ status: 'SUBMITTED' }));
    fireEvent.press(view.getByText('Ask for changes'));
    fireEvent.changeText(view.getByLabelText('What should be changed?'), 'One socket missing');
    await act(async () => { fireEvent.press(view.getByText('Send back for changes')); });
    expect(mocked.requestStageChanges).toHaveBeenCalledWith('s1', 'One socket missing');
  });

  it('a direct-payment professional starts, sends work with a note, and confirms the money', async () => {
    const hired = project({ viewer: 'hired', paymentMode: 'DIRECT' });
    const a = card(hired, stage());
    await act(async () => { fireEvent.press(a.getByText('Start this stage')); });
    expect(mocked.startStage).toHaveBeenCalled();
    const b = card(hired, stage({ status: 'IN_PROGRESS', changesNote: 'Fix it' }));
    expect(b.getByText('Changes asked: Fix it')).toBeTruthy();
    fireEvent.press(b.getByText('I finished this stage'));
    fireEvent.changeText(b.getByLabelText('What did you do? (or add a photo)'), 'All done');
    await act(async () => { fireEvent.press(b.getByText('Send for approval')); });
    expect(mocked.submitStage).toHaveBeenCalledWith('s1', { note: 'All done', photoUploadIds: [] });
    const c = card(hired, stage({ status: 'APPROVED' }));
    fireEvent.press(c.getByText(/^I received/));
    await act(async () => { fireEvent.press(c.getByText(/^I received/)); });
    expect(mocked.markStagePaid).toHaveBeenCalledWith('s1');
  });

  it('shows a plain message when a step fails, and lets a problem be reported', async () => {
    mocked.disputeStage.mockRejectedValue(new Error('x'));
    const onChanged = jest.fn();
    const view = card(project(), stage({ status: 'IN_PROGRESS' }), onChanged);
    fireEvent.press(view.getByText('Report a problem'));
    fireEvent.changeText(view.getByLabelText('What is wrong?'), 'Nobody came');
    await act(async () => { fireEvent.press(view.getByText('Tell Fixli')); });
    expect(view.getByRole('alert')).toBeTruthy();
    expect(onChanged).toHaveBeenCalled();
  });

  it('offers nothing on stages that are not current', () => {
    const view = renderWithStore(<StageCard project={project()} stage={stage()} current={false} onChanged={jest.fn()} index={0} />);
    expect(view.queryByText(/^Pay /)).toBeNull();
    expect(view.queryByText('Report a problem')).toBeNull();
  });
});

describe('pricing a project', () => {
  const open = (over: Partial<api.ProjectView> = {}) => project({ viewer: 'candidate', status: 'OPEN', suggestedMilestones: [{ title: 'Pipes', percent: 40 }, { title: 'Fittings', percent: 60 }], ...over });

  it('splits the total into the suggested stages automatically', () => {
    const onSubmit = jest.fn();
    const view = renderWithStore(<BidForm project={open()} busy={false} onSubmit={onSubmit} />);
    fireEvent.changeText(view.getByTestId('bid-total'), '1000');
    fireEvent.press(view.getByText('Send my price'));
    expect(onSubmit).toHaveBeenCalledWith({ totalAmount: 100_000, durationDays: 7, note: undefined, milestones: [{ title: 'Pipes', amount: 40_000 }, { title: 'Fittings', amount: 60_000 }] });
  });

  it('will not send hand-edited stages that do not add up', () => {
    const onSubmit = jest.fn();
    const view = renderWithStore(<BidForm project={open()} busy={false} onSubmit={onSubmit} />);
    fireEvent.changeText(view.getByTestId('bid-total'), '1000');
    fireEvent.changeText(view.getAllByLabelText('Amount')[0], '100');
    fireEvent.press(view.getByText('Send my price'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(view.getByText(/Stages total/)).toBeTruthy();
    fireEvent.press(view.getByText('Split the total for me'));
    fireEvent.press(view.getByText('Send my price'));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('asks how to pay before hiring, offering card only where it works', () => {
    const bid: api.ProjectBidCard = { id: 'b', totalAmount: 100_000, currency: 'PKR', durationDays: 3, note: 'Copper', status: 'PENDING', milestones: [{ title: 'All', amount: 100_000 }],
      worker: { id: 'w', name: 'Ali Raza', businessName: null, teamSize: 4, profileImageUrl: null, rating: 4.5, ratingCount: 2, jobsCompleted: 3, isVerified: true, experienceYears: 5, distanceKm: 2 } };
    const onHire = jest.fn();
    const view = renderWithStore(<BidCard bid={bid} cardAvailable={false} busy={false} onHire={onHire} />);
    fireEvent.press(view.getByText('Hire Ali'));
    expect(view.queryByText('Pay by card through Fixli')).toBeNull();
    fireEvent.press(view.getByText('Hire'));
    expect(onHire).toHaveBeenCalledWith('DIRECT');
  });
});

describe('materials, visits and lists', () => {
  const hired = project({
    materials: [{ id: 'm1', name: 'Wire', quantity: 3, unit: 'coils', providedBy: 'customer', isReady: false, addedById: 'u1' }],
    visits: [{ id: 'v1', scheduledAt: '2027-02-01T09:00:00Z', note: 'Measure', status: 'PLANNED' }],
  });
  beforeEach(() => jest.clearAllMocks());

  it('ticks, removes and adds materials', async () => {
    const view = renderWithStore(<Materials project={hired} userId="u1" onChanged={jest.fn()} />);
    await act(async () => { fireEvent.press(view.getByRole('checkbox')); });
    expect(mocked.setMaterialReady).toHaveBeenCalledWith('p1', 'm1', true);
    await act(async () => { fireEvent.press(view.getByLabelText('Remove Wire')); });
    expect(mocked.removeMaterial).toHaveBeenCalledWith('p1', 'm1');
    fireEvent.press(view.getByText('Add material'));
    fireEvent.changeText(view.getByLabelText('What is needed'), 'Switches');
    await act(async () => { fireEvent.press(view.getByText('Add material')); });
    expect(mocked.addMaterial).toHaveBeenCalledWith('p1', { name: 'Switches', quantity: 1, unit: undefined, providedBy: 'customer' });
  });

  it('plans and completes visits', async () => {
    const view = renderWithStore(<Visits project={hired} onChanged={jest.fn()} />);
    await act(async () => { fireEvent.press(view.getByText('Visit done')); });
    expect(mocked.updateVisit).toHaveBeenCalledWith('p1', 'v1', 'DONE');
    fireEvent.press(view.getByText('Plan a visit'));
    await act(async () => { fireEvent.press(view.getByText('Plan a visit')); });
    await waitFor(() => expect(mocked.addVisit).toHaveBeenCalled());
    expect(new Date(mocked.addVisit.mock.calls[0][1]).getTime()).toBeGreaterThan(Date.now());
  });

  it('summarises a project in a list for each side', () => {
    const item: api.ProjectListItem = { id: 'p', title: 'Solar roof', status: 'OPEN', workType: 'INSTALLATION', area: 'Gulshan', city: 'Karachi', currency: 'PKR', agreedAmount: null, budgetMin: null, budgetMax: 100_000,
      createdAt: '', category: { id: 'c', name: 'SOLAR', iconName: 'sunny' }, bidCount: 2, stages: { total: 2, done: 1 }, currentStage: { title: 'Panels', status: 'IN_PROGRESS' } };
    const view = renderWithStore(<ProjectCard project={item} viewer="customer" />);
    expect(view.getByText('2 prices received')).toBeTruthy();
    expect(view.getByText(/1 of 2 stages done · Panels/)).toBeTruthy();
  });
});
