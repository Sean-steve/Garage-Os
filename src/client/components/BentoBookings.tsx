/**
 * BentoBookings — Sprint 11 Customer & Provider Service Transactions
 *
 * Implements:
 * - Service Catalog & Offerings
 * - Slot Availability & Capacity Hold Management (GAR-013 §4)
 * - Booking Lifecycle: Requested -> Confirmed -> Checked-In -> Completed
 * - Real-Time Vehicle Check-in bridging into Garage Operations ServiceCase
 * - Service Quotes & Estimates with Line-Item Approvals (Mandatory vs Recommended)
 * - Quote Issuance, Acceptance, Rejection, and Versioned Revision Chaining
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Calendar,
  Clock,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Plus,
  ArrowRight,
  ShieldCheck,
  Building,
  Car,
  FileText,
  DollarSign,
  Tag,
  RefreshCw,
  Eye,
  Check,
  X,
  Layers,
  ChevronRight,
  Info,
  Sliders,
  Send,
  Sparkles,
  MapPin,
  FileCheck
} from 'lucide-react';
import { VehicleSummary } from '../types';

interface BentoBookingsProps {
  vehicles: VehicleSummary[];
  selectedVehicleId: string;
  onSelectVehicle: (id: string) => void;
  onNotify?: (msg: string) => void;
}

export const BentoBookings: React.FC<BentoBookingsProps> = ({
  vehicles,
  selectedVehicleId,
  onSelectVehicle,
  onNotify,
}) => {
  const [subTab, setSubTab] = useState<'bookings' | 'offerings' | 'slots' | 'quotes'>('bookings');
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<boolean>(false);

  // Data collections
  const [bookings, setBookings] = useState<any[]>([]);
  const [offerings, setOfferings] = useState<any[]>([]);
  const [quotes, setQuotes] = useState<any[]>([]);
  const [availableSlots, setAvailableSlots] = useState<any[]>([]);
  const [activeHold, setActiveHold] = useState<any | null>(null);

  // Selected details
  const [selectedBooking, setSelectedBooking] = useState<any | null>(null);
  const [selectedQuote, setSelectedQuote] = useState<any | null>(null);

  // Modals
  const [showNewBookingModal, setShowNewBookingModal] = useState<boolean>(false);
  const [showNewQuoteModal, setShowNewQuoteModal] = useState<boolean>(false);
  const [showRescheduleModal, setShowRescheduleModal] = useState<boolean>(false);

  // New Booking Form State
  const [newBookingForm, setNewBookingForm] = useState({
    vehicle_id: selectedVehicleId,
    service_offering_id: '',
    delivery_mode: 'WORKSHOP',
    slot_start_at: '',
    slot_end_at: '',
    customer_notes: '',
    concerns: '',
  });

  // Reschedule Form State
  const [rescheduleForm, setRescheduleForm] = useState({
    proposed_start_at: '',
    proposed_end_at: '',
    reason: '',
  });

  // New Quote Form State
  const [newQuoteForm, setNewQuoteForm] = useState({
    booking_id: '',
    title: 'Comprehensive Service & Diagnostic Quote',
    currency: 'KES',
    expires_in_days: 7,
    notes: 'Includes genuine OEM oil filter and synthetic fluid service.',
    line_items: [
      {
        line_item_type: 'LABOR',
        item_code: 'LAB-SVC-01',
        description: 'Comprehensive 50-Point Multi-System Diagnostic & Inspection',
        quantity: 1,
        unit_price_minor: 350000, // 3,500.00 KES
        is_mandatory: true,
        approval_status: 'PENDING',
      },
      {
        line_item_type: 'PARTS',
        item_code: 'PART-SYN-05W30',
        description: 'Synthetic 5W-30 Engine Oil (4.5L Drum)',
        quantity: 1,
        unit_price_minor: 650000, // 6,500.00 KES
        is_mandatory: true,
        approval_status: 'PENDING',
      },
      {
        line_item_type: 'PARTS',
        item_code: 'PART-FLT-OIL',
        description: 'OEM Oil Filter Cartridge & O-Ring Seal',
        quantity: 1,
        unit_price_minor: 180000, // 1,800.00 KES
        is_mandatory: true,
        approval_status: 'PENDING',
      },
      {
        line_item_type: 'LABOR',
        item_code: 'LAB-ALIGN-3D',
        description: 'Laser Wheel Alignment & Steering Balance (Recommended)',
        quantity: 1,
        unit_price_minor: 250000, // 2,500.00 KES
        is_mandatory: false,
        approval_status: 'PENDING',
      },
    ],
  });

  // Quote line items selection state for authorization
  const [selectedItemIds, setSelectedItemIds] = useState<Record<string, boolean>>({});

  // Fetch initial data
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [bookingsRes, offeringsRes, quotesRes] = await Promise.all([
        fetch('/api/v1/bookings'),
        fetch('/api/v1/offerings'),
        fetch('/api/v1/quotes'),
      ]);

      if (bookingsRes.ok) {
        const bData = await bookingsRes.json();
        setBookings(bData.data || []);
      }
      if (offeringsRes.ok) {
        const oData = await offeringsRes.json();
        const offList = oData.data || [];
        setOfferings(offList);
        if (offList.length > 0 && !newBookingForm.service_offering_id) {
          setNewBookingForm((prev) => ({ ...prev, service_offering_id: offList[0].id }));
        }
      }
      if (quotesRes.ok) {
        const qData = await quotesRes.json();
        setQuotes(qData.data || []);
      }
    } catch (err) {
      console.error('Failed loading booking data', err);
    } finally {
      setLoading(false);
    }
  }, [newBookingForm.service_offering_id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Fetch Slots
  const fetchSlots = useCallback(async () => {
    try {
      const providerId = 'srv_seed_garage_01';
      const today = new Date().toISOString().split('T')[0];
      const future = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
      const res = await fetch(`/api/v1/capacity/slots?provider_id=${providerId}&from_date=${today}&to_date=${future}&duration_minutes=60`);
      if (res.ok) {
        const data = await res.json();
        setAvailableSlots(data.data || []);
      }
    } catch (e) {
      console.error('Failed fetching slots', e);
    }
  }, []);

  useEffect(() => {
    if (subTab === 'slots') {
      fetchSlots();
    }
  }, [subTab, fetchSlots]);

  // Sync selected vehicle
  useEffect(() => {
    setNewBookingForm((prev) => ({ ...prev, vehicle_id: selectedVehicleId }));
  }, [selectedVehicleId]);

  // Auto-select items when viewing quote
  useEffect(() => {
    if (selectedQuote && selectedQuote.line_items) {
      const initial: Record<string, boolean> = {};
      selectedQuote.line_items.forEach((item: any) => {
        // Pre-select approved or pending mandatory items
        initial[item.id] = item.approval_status === 'APPROVED' || item.is_mandatory;
      });
      setSelectedItemIds(initial);
    }
  }, [selectedQuote]);

  // Create Capacity Hold
  const handleCreateHold = async (slot: any) => {
    try {
      setActionLoading(true);
      const res = await fetch('/api/v1/capacity/holds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider_id: slot.provider_id || 'srv_seed_garage_01',
          branch_id: slot.branch_id || 'prvbr_seed_01',
          slot_start_at: slot.start_at,
          slot_end_at: slot.end_at,
          hold_duration_minutes: 15,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setActiveHold(data.data);
        setNewBookingForm((prev) => ({
          ...prev,
          slot_start_at: slot.start_at,
          slot_end_at: slot.end_at,
        }));
        onNotify?.(`Capacity slot held for 15 minutes: ${new Date(slot.start_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
      } else {
        onNotify?.(`Error: ${data.error?.message || 'Failed to hold slot'}`);
      }
    } catch (e: any) {
      onNotify?.(`Error: ${e.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  // Submit New Booking
  const handleCreateBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setActionLoading(true);
      const startAt = newBookingForm.slot_start_at || new Date(Date.now() + 3600000 * 24).toISOString();
      const endAt = newBookingForm.slot_end_at || new Date(Date.now() + 3600000 * 25).toISOString();

      const items = newBookingForm.service_offering_id ? [{
        service_offering_id: newBookingForm.service_offering_id,
        quantity: 1,
      }] : [];

      const concerns = newBookingForm.concerns ? newBookingForm.concerns.split(',').map((c) => c.trim()) : [];

      const res = await fetch('/api/v1/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider_id: 'srv_seed_garage_01',
          branch_id: 'prvbr_seed_01',
          vehicle_id: newBookingForm.vehicle_id,
          delivery_mode: newBookingForm.delivery_mode,
          slot_start_at: startAt,
          slot_end_at: endAt,
          capacity_hold_id: activeHold?.id,
          customer_notes: newBookingForm.customer_notes,
          customer_reported_concerns: concerns,
          items,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setShowNewBookingModal(false);
        setActiveHold(null);
        await fetchData();
        onNotify?.(`Booking ${data.data.booking_reference} successfully placed (${data.data.status})`);
      } else {
        onNotify?.(`Booking failed: ${data.error?.message || 'Validation error'}`);
      }
    } catch (e: any) {
      onNotify?.(`Booking failed: ${e.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  // Confirm Booking (Provider Advisor role)
  const handleConfirmBooking = async (bookingId: string) => {
    try {
      setActionLoading(true);
      const res = await fetch(`/api/v1/bookings/${bookingId}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notes: 'Confirmed by Westlands Workshop Service Advisor. Bay #2 allocated.',
        }),
      });
      const data = await res.json();
      if (res.ok) {
        await fetchData();
        if (selectedBooking?.id === bookingId) {
          setSelectedBooking(data.data);
        }
        onNotify?.(`Booking confirmed! Appointment scheduled.`);
      } else {
        onNotify?.(`Failed: ${data.error?.message}`);
      }
    } catch (e: any) {
      onNotify?.(`Error: ${e.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  // Check-In Vehicle (Bridge to Workshop Operations Service Case)
  const handleCheckInBooking = async (bookingId: string) => {
    try {
      setActionLoading(true);
      const res = await fetch(`/api/v1/bookings/${bookingId}/check-in`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intake_odometer: 64210,
          intake_notes: 'Vehicle arrived on site. Key received. Walkaround completed with zero pre-existing body damage.',
          fuel_level_fraction: 0.65,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        await fetchData();
        if (selectedBooking?.id === bookingId) {
          setSelectedBooking(data.data.booking);
        }
        onNotify?.(`Vehicle Checked-In! Linked to Service Case ${data.data.service_case_id}`);
      } else {
        onNotify?.(`Check-in failed: ${data.error?.message}`);
      }
    } catch (e: any) {
      onNotify?.(`Error: ${e.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  // Propose Reschedule
  const handleProposeReschedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBooking) return;
    try {
      setActionLoading(true);
      const res = await fetch(`/api/v1/bookings/${selectedBooking.id}/reschedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposed_start_at: rescheduleForm.proposed_start_at,
          proposed_end_at: rescheduleForm.proposed_end_at,
          reason: rescheduleForm.reason,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setShowRescheduleModal(false);
        await fetchData();
        onNotify?.(`Reschedule proposal recorded. Awaiting customer acceptance.`);
      } else {
        onNotify?.(`Reschedule failed: ${data.error?.message}`);
      }
    } catch (e: any) {
      onNotify?.(`Error: ${e.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  // Issue Quote
  const handleIssueQuote = async (quoteId: string) => {
    try {
      setActionLoading(true);
      const res = await fetch(`/api/v1/quotes/${quoteId}/issue`, {
        method: 'POST',
      });
      const data = await res.json();
      if (res.ok) {
        await fetchData();
        if (selectedQuote?.id === quoteId) {
          setSelectedQuote(data.data);
        }
        onNotify?.(`Quote ${data.data.quote_number} issued to customer and locked!`);
      } else {
        onNotify?.(`Failed to issue quote: ${data.error?.message}`);
      }
    } catch (e: any) {
      onNotify?.(`Error: ${e.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  // Customer Authorizes Quote Items
  const handleAcceptQuote = async (quoteId: string) => {
    try {
      setActionLoading(true);
      const acceptedLineItemIds = Object.entries(selectedItemIds)
        .filter(([_, checked]) => checked)
        .map(([id]) => id);

      if (acceptedLineItemIds.length === 0) {
        onNotify?.('Please select at least one line item to authorize.');
        setActionLoading(false);
        return;
      }

      const res = await fetch(`/api/v1/quotes/${quoteId}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accepted_line_item_ids: acceptedLineItemIds,
          notes: 'Customer digital approval verified via Garage OS portal.',
        }),
      });

      const data = await res.json();
      if (res.ok) {
        await fetchData();
        if (selectedQuote?.id === quoteId) {
          setSelectedQuote(data.data.quote);
        }
        onNotify?.(`Quote Authorized! Total minor authorized: ${data.data.total_authorized_minor} KES. Bridge to Workshop Authorization active.`);
      } else {
        onNotify?.(`Authorization failed: ${data.error?.message}`);
      }
    } catch (e: any) {
      onNotify?.(`Error: ${e.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  // Create Quote
  const handleCreateQuote = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setActionLoading(true);
      const res = await fetch('/api/v1/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider_id: 'srv_seed_garage_01',
          branch_id: 'prvbr_seed_01',
          customer_user_id: 'usr_seed_owner_01',
          vehicle_id: selectedVehicleId,
          booking_id: newQuoteForm.booking_id || undefined,
          title: newQuoteForm.title,
          currency: newQuoteForm.currency,
          expires_in_days: newQuoteForm.expires_in_days,
          customer_notes: newQuoteForm.notes,
          line_items: newQuoteForm.line_items,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setShowNewQuoteModal(false);
        await fetchData();
        setSelectedQuote(data.data);
        onNotify?.(`Quote ${data.data.quote_number} created in DRAFT state.`);
      } else {
        onNotify?.(`Quote creation failed: ${data.error?.message}`);
      }
    } catch (e: any) {
      onNotify?.(`Error: ${e.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const currentVehicle = vehicles.find((v) => v.id === selectedVehicleId);

  return (
    <div className="space-y-6">
      {/* Top Banner / Breadcrumb & Vehicle Selector */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-slate-900/90 border border-slate-800 rounded-xl shadow-lg">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
            <Calendar className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-white tracking-tight">Service Transactions & Scheduling</h2>
              <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-full">
                Sprint 11 (GAR-013)
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Customer Booking, Provider Real-Time Capacity, Line-Item Quote Approvals & Workshop Check-in
            </p>
          </div>
        </div>

        {/* Vehicle Selector */}
        <div className="flex items-center gap-3">
          <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Active Vehicle:</label>
          <select
            value={selectedVehicleId}
            onChange={(e) => onSelectVehicle(e.target.value)}
            className="bg-slate-950 border border-slate-700 text-white text-xs rounded-lg px-3 py-2 font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.model_year} {v.make} {v.model} ({v.registration_number || v.vin?.slice(-6) || v.id})
              </option>
            ))}
          </select>
          <button
            onClick={fetchData}
            disabled={loading}
            className="p-2 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 transition"
            title="Refresh Data"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-indigo-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Sub-Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
        <button
          onClick={() => setSubTab('bookings')}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-lg transition ${
            subTab === 'bookings'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/25'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
          }`}
        >
          <Calendar className="w-4 h-4" />
          <span>Bookings ({bookings.length})</span>
        </button>

        <button
          onClick={() => setSubTab('offerings')}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-lg transition ${
            subTab === 'offerings'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/25'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
          }`}
        >
          <Tag className="w-4 h-4" />
          <span>Service Catalog ({offerings.length})</span>
        </button>

        <button
          onClick={() => setSubTab('slots')}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-lg transition ${
            subTab === 'slots'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/25'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
          }`}
        >
          <Clock className="w-4 h-4" />
          <span>Capacity & Slots</span>
        </button>

        <button
          onClick={() => setSubTab('quotes')}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-lg transition ${
            subTab === 'quotes'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/25'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
          }`}
        >
          <DollarSign className="w-4 h-4" />
          <span>Quotes & Approvals ({quotes.length})</span>
        </button>
      </div>

      {/* SUBTAB 1: BOOKINGS */}
      {subTab === 'bookings' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left 2 Cols: Bookings List */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <span>Active Service Appointments & Requests</span>
                <span className="px-2 py-0.5 text-[10px] bg-slate-800 text-slate-300 rounded-full font-mono">
                  {bookings.length}
                </span>
              </h3>
              <button
                onClick={() => setShowNewBookingModal(true)}
                className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition shadow-md shadow-indigo-600/20"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New Booking Request</span>
              </button>
            </div>

            {bookings.length === 0 ? (
              <div className="p-8 text-center bg-slate-900/60 border border-slate-800 rounded-xl">
                <Calendar className="w-8 h-8 text-slate-500 mx-auto mb-2" />
                <p className="text-sm text-slate-400">No active bookings recorded yet.</p>
                <button
                  onClick={() => setShowNewBookingModal(true)}
                  className="mt-3 text-xs text-indigo-400 hover:text-indigo-300 font-bold underline"
                >
                  Create your first booking
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {bookings.map((b) => {
                  const isSelected = selectedBooking?.id === b.id;
                  const statusColors: Record<string, string> = {
                    REQUESTED: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
                    CONFIRMED: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
                    CHECKED_IN: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
                    COMPLETED: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
                    CANCELLED: 'bg-red-500/20 text-red-300 border-red-500/30',
                  };

                  return (
                    <div
                      key={b.id}
                      onClick={() => setSelectedBooking(b)}
                      className={`p-4 rounded-xl border transition cursor-pointer ${
                        isSelected
                          ? 'bg-slate-800/90 border-indigo-500/60 ring-1 ring-indigo-500/30 shadow-lg'
                          : 'bg-slate-900/70 border-slate-800 hover:border-slate-700 hover:bg-slate-800/40'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-bold text-indigo-400">
                              {b.booking_reference}
                            </span>
                            <span
                              className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full border ${
                                statusColors[b.status] || 'bg-slate-800 text-slate-300 border-slate-700'
                              }`}
                            >
                              {b.status}
                            </span>
                            <span className="text-[10px] text-slate-400 font-mono">
                              Mode: {b.delivery_mode}
                            </span>
                          </div>
                          <h4 className="text-sm font-bold text-white mt-1">
                            {b.items && b.items.length > 0
                              ? b.items.map((i: any) => i.description).join(' + ')
                              : 'Standard Inspection & Maintenance'}
                          </h4>
                        </div>

                        <div className="text-right">
                          <div className="text-xs text-slate-300 flex items-center justify-end gap-1.5 font-mono">
                            <Clock className="w-3.5 h-3.5 text-indigo-400" />
                            <span>
                              {b.appointment?.scheduled_start_at
                                ? new Date(b.appointment.scheduled_start_at).toLocaleDateString([], {
                                    month: 'short',
                                    day: 'numeric',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })
                                : 'Pending Confirmation'}
                            </span>
                          </div>
                          {b.service_case_id && (
                            <span className="inline-block mt-1 text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                              Case: {b.service_case_id}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Concerns list if any */}
                      {b.concerns && b.concerns.length > 0 && (
                        <div className="mt-3 pt-2 border-t border-slate-800/80 flex flex-wrap gap-1.5">
                          {b.concerns.map((c: any, idx: number) => (
                            <span
                              key={idx}
                              className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded-md border border-slate-700/60"
                            >
                              • {c.description}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right Col: Booking Inspector & Actions */}
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              Booking Detail & Actions
            </h3>

            {selectedBooking ? (
              <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-500">Reference</span>
                    <p className="font-mono text-base font-bold text-indigo-400">
                      {selectedBooking.booking_reference}
                    </p>
                  </div>
                  <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-slate-800 text-white border border-slate-700 font-mono">
                    {selectedBooking.status}
                  </span>
                </div>

                <div className="space-y-2 text-xs">
                  <div className="flex justify-between py-1 border-b border-slate-800/60">
                    <span className="text-slate-400">Vehicle ID:</span>
                    <span className="font-mono text-slate-200">{selectedBooking.vehicle_id}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-800/60">
                    <span className="text-slate-400">Provider:</span>
                    <span className="text-slate-200 font-medium">{selectedBooking.provider_id}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-800/60">
                    <span className="text-slate-400">Delivery Mode:</span>
                    <span className="text-indigo-300 font-bold">{selectedBooking.delivery_mode}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-800/60">
                    <span className="text-slate-400">Scheduled:</span>
                    <span className="text-slate-200 font-mono">
                      {selectedBooking.appointment?.scheduled_start_at
                        ? new Date(selectedBooking.appointment.scheduled_start_at).toLocaleString()
                        : 'Unscheduled'}
                    </span>
                  </div>
                  {selectedBooking.service_case_id && (
                    <div className="flex justify-between py-1 border-b border-slate-800/60">
                      <span className="text-slate-400">Workshop Case:</span>
                      <span className="text-emerald-400 font-mono font-bold">
                        {selectedBooking.service_case_id}
                      </span>
                    </div>
                  )}
                </div>

                {/* State Machine Actions */}
                <div className="pt-2 space-y-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                    Available Workflow Transitions:
                  </span>

                  {selectedBooking.status === 'REQUESTED' && (
                    <button
                      onClick={() => handleConfirmBooking(selectedBooking.id)}
                      disabled={actionLoading}
                      className="w-full flex items-center justify-center gap-2 py-2 text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Confirm Appointment (Provider)</span>
                    </button>
                  )}

                  {selectedBooking.status === 'CONFIRMED' && (
                    <button
                      onClick={() => handleCheckInBooking(selectedBooking.id)}
                      disabled={actionLoading}
                      className="w-full flex items-center justify-center gap-2 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition shadow-md shadow-emerald-600/20"
                    >
                      <Car className="w-4 h-4" />
                      <span>Vehicle Check-In (Bridge to Workshop)</span>
                    </button>
                  )}

                  {['REQUESTED', 'CONFIRMED'].includes(selectedBooking.status) && (
                    <button
                      onClick={() => {
                        setRescheduleForm({
                          proposed_start_at: new Date(Date.now() + 86400000 * 2).toISOString(),
                          proposed_end_at: new Date(Date.now() + 86400000 * 2 + 3600000).toISOString(),
                          reason: 'Customer requested change of time slot',
                        });
                        setShowRescheduleModal(true);
                      }}
                      className="w-full flex items-center justify-center gap-2 py-2 text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition border border-slate-700"
                    >
                      <Clock className="w-4 h-4" />
                      <span>Propose Reschedule</span>
                    </button>
                  )}

                  <button
                    onClick={() => {
                      setNewQuoteForm((prev) => ({
                        ...prev,
                        booking_id: selectedBooking.id,
                        title: `Estimate & Quote for ${selectedBooking.booking_reference}`,
                      }));
                      setShowNewQuoteModal(true);
                    }}
                    className="w-full flex items-center justify-center gap-2 py-2 text-xs font-bold bg-slate-800 hover:bg-slate-700 text-indigo-300 rounded-lg transition border border-slate-700"
                  >
                    <FileText className="w-4 h-4" />
                    <span>Generate Service Quote</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-6 bg-slate-900/40 border border-dashed border-slate-800 rounded-xl text-center">
                <Info className="w-6 h-6 text-slate-600 mx-auto mb-2" />
                <p className="text-xs text-slate-400">Select a booking to view details, verify workflow gates, or check-in the vehicle.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUBTAB 2: SERVICE CATALOG & OFFERINGS */}
      {subTab === 'offerings' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Provider Service Catalog & Pricing Models
              </h3>
              <p className="text-xs text-slate-400">
                Offerings configured with duration estimates, pricing models (Fixed, Range, Diagnostic Fee), and delivery channels.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {offerings.map((off) => (
              <div
                key={off.id}
                className="p-5 bg-slate-900 border border-slate-800 rounded-xl hover:border-slate-700 transition flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 rounded-full font-mono">
                      {off.category_id}
                    </span>
                    <span className="text-xs font-mono font-bold text-emerald-400">
                      {((off.base_price_minor || 0) / 100).toLocaleString()} {off.currency}
                    </span>
                  </div>
                  <h4 className="text-sm font-bold text-white">{off.name}</h4>
                  <p className="text-xs text-slate-400 mt-1 line-clamp-2">{off.description}</p>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
                  <div className="flex items-center gap-1 font-mono">
                    <Clock className="w-3.5 h-3.5 text-indigo-400" />
                    <span>{off.duration_estimate_minutes} mins</span>
                  </div>
                  <div className="flex items-center gap-1 font-mono text-indigo-300 font-bold">
                    <span>{off.pricing_model}</span>
                  </div>
                  <button
                    onClick={() => {
                      setNewBookingForm((prev) => ({
                        ...prev,
                        service_offering_id: off.id,
                      }));
                      setShowNewBookingModal(true);
                    }}
                    className="px-2.5 py-1 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 rounded-md transition"
                  >
                    Book Now
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SUBTAB 3: CAPACITY & SLOT FINDER */}
      {subTab === 'slots' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Real-Time Provider Capacity & Availability
              </h3>
              <p className="text-xs text-slate-400">
                Operating hours, slot intervals, concurrent limits, schedule blocks, and active capacity holds.
              </p>
            </div>
            {activeHold && (
              <div className="flex items-center gap-2 px-3 py-1 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-300 text-xs font-mono">
                <Clock className="w-3.5 h-3.5 animate-pulse" />
                <span>Slot Held until: {new Date(activeHold.expires_at).toLocaleTimeString()}</span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {availableSlots.length === 0 ? (
              <div className="col-span-full p-8 text-center bg-slate-900/60 border border-slate-800 rounded-xl">
                <Clock className="w-8 h-8 text-slate-500 mx-auto mb-2" />
                <p className="text-sm text-slate-400">Querying available slots...</p>
              </div>
            ) : (
              availableSlots.map((s, idx) => (
                <div
                  key={idx}
                  className="p-4 bg-slate-900 border border-slate-800 rounded-xl flex items-center justify-between"
                >
                  <div>
                    <div className="text-xs font-bold text-white">
                      {new Date(s.start_at).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
                    </div>
                    <div className="text-sm font-mono font-bold text-indigo-400 mt-0.5">
                      {new Date(s.start_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} -{' '}
                      {new Date(s.end_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                    <div className="text-[10px] text-slate-400 mt-1 font-mono">
                      Capacity Remaining: {s.capacity_remaining} / {s.capacity_limit}
                    </div>
                  </div>

                  <button
                    onClick={() => handleCreateHold(s)}
                    disabled={actionLoading || s.capacity_remaining <= 0}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg transition"
                  >
                    <Sparkles className="w-3 h-3" />
                    <span>Hold Slot</span>
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* SUBTAB 4: QUOTES & ITEM-LEVEL AUTHORIZATION */}
      {subTab === 'quotes' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Quotes list */}
          <div className="lg:col-span-1 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Service Quotes ({quotes.length})
              </h3>
              <button
                onClick={() => setShowNewQuoteModal(true)}
                className="flex items-center gap-1 px-2.5 py-1 text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition"
              >
                <Plus className="w-3 h-3" />
                <span>New Quote</span>
              </button>
            </div>

            {quotes.map((q) => {
              const isSelected = selectedQuote?.id === q.id;
              const statusColors: Record<string, string> = {
                DRAFT: 'bg-slate-800 text-slate-300 border-slate-700',
                ISSUED: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
                VIEWED: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
                ACCEPTED: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
                PARTIALLY_ACCEPTED: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
                REJECTED: 'bg-red-500/20 text-red-300 border-red-500/30',
              };

              return (
                <div
                  key={q.id}
                  onClick={() => setSelectedQuote(q)}
                  className={`p-4 rounded-xl border transition cursor-pointer ${
                    isSelected
                      ? 'bg-slate-800/90 border-indigo-500/60 ring-1 ring-indigo-500/30 shadow-lg'
                      : 'bg-slate-900/70 border-slate-800 hover:border-slate-700 hover:bg-slate-800/40'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold text-indigo-400">{q.quote_number}</span>
                    <span
                      className={`px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded-full border ${
                        statusColors[q.status] || 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      {q.status}
                    </span>
                  </div>
                  <h4 className="text-sm font-bold text-white mt-1">{q.title}</h4>
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-800/80 text-xs font-mono">
                    <span className="text-slate-400">Total:</span>
                    <span className="text-emerald-400 font-bold">
                      {((q.total_minor || 0) / 100).toLocaleString()} {q.currency}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Quote Inspector & Interactive Line Item Authorization */}
          <div className="lg:col-span-2 space-y-4">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              Quote Line-Item Authorization & Breakdown
            </h3>

            {selectedQuote ? (
              <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl space-y-5">
                {/* Header info */}
                <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-slate-800">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-lg font-bold text-indigo-400">
                        {selectedQuote.quote_number}
                      </span>
                      <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-slate-800 text-white border border-slate-700">
                        {selectedQuote.status}
                      </span>
                    </div>
                    <h4 className="text-base font-bold text-white mt-1">{selectedQuote.title}</h4>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Expires: {new Date(selectedQuote.expires_at).toLocaleDateString()} • Version: v{selectedQuote.version_number}
                    </p>
                  </div>

                  <div className="text-right">
                    <div className="text-xs text-slate-400 uppercase tracking-wider font-bold">Total Quote</div>
                    <div className="text-2xl font-bold font-mono text-emerald-400">
                      {((selectedQuote.total_minor || 0) / 100).toLocaleString()} {selectedQuote.currency}
                    </div>
                  </div>
                </div>

                {/* Line Items Table with Interactive Selection */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                      Line Items (Check to Authorize)
                    </span>
                    <span className="text-[11px] text-slate-500">
                      Mandatory items are required for safe vehicle release
                    </span>
                  </div>

                  <div className="space-y-2">
                    {selectedQuote.line_items?.map((item: any) => {
                      const isChecked = !!selectedItemIds[item.id];
                      return (
                        <div
                          key={item.id}
                          className={`p-3 rounded-lg border transition flex items-center justify-between ${
                            isChecked
                              ? 'bg-slate-800/80 border-indigo-500/40'
                              : 'bg-slate-950/50 border-slate-800 opacity-60'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              disabled={selectedQuote.status === 'ACCEPTED'}
                              onChange={(e) => {
                                setSelectedItemIds((prev) => ({
                                  ...prev,
                                  [item.id]: e.target.checked,
                                }));
                              }}
                              className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-indigo-500"
                            />
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-white">{item.description}</span>
                                <span className="text-[9px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 font-mono">
                                  {item.line_item_type}
                                </span>
                                {item.is_mandatory && (
                                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-red-500/20 text-red-300 font-bold border border-red-500/30">
                                    MANDATORY
                                  </span>
                                )}
                              </div>
                              <span className="text-[10px] text-slate-500 font-mono">
                                Code: {item.item_code} • Qty: {item.quantity}
                              </span>
                            </div>
                          </div>

                          <div className="text-right font-mono">
                            <div className="text-xs font-bold text-slate-200">
                              {((item.total_minor || 0) / 100).toLocaleString()} {selectedQuote.currency}
                            </div>
                            <span
                              className={`text-[9px] uppercase font-bold ${
                                item.approval_status === 'APPROVED'
                                  ? 'text-emerald-400'
                                  : item.approval_status === 'REJECTED'
                                  ? 'text-red-400'
                                  : 'text-amber-400'
                              }`}
                            >
                              {item.approval_status}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Subtotals & Taxes breakdown */}
                <div className="p-3 bg-slate-950/60 rounded-lg border border-slate-800/80 space-y-1 text-xs font-mono">
                  <div className="flex justify-between text-slate-400">
                    <span>Labor Subtotal:</span>
                    <span>{((selectedQuote.labor_total_minor || 0) / 100).toLocaleString()} {selectedQuote.currency}</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Parts Subtotal:</span>
                    <span>{((selectedQuote.parts_total_minor || 0) / 100).toLocaleString()} {selectedQuote.currency}</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Tax (16% VAT):</span>
                    <span>{((selectedQuote.tax_total_minor || 0) / 100).toLocaleString()} {selectedQuote.currency}</span>
                  </div>
                  <div className="flex justify-between text-white font-bold pt-2 border-t border-slate-800 text-sm">
                    <span>Grand Total:</span>
                    <span className="text-emerald-400">
                      {((selectedQuote.total_minor || 0) / 100).toLocaleString()} {selectedQuote.currency}
                    </span>
                  </div>
                </div>

                {/* Action Controls */}
                <div className="flex flex-wrap gap-3 pt-2">
                  {selectedQuote.status === 'DRAFT' && (
                    <button
                      onClick={() => handleIssueQuote(selectedQuote.id)}
                      disabled={actionLoading}
                      className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition"
                    >
                      <Send className="w-4 h-4" />
                      <span>Issue Quote (Locks & Sends to Customer)</span>
                    </button>
                  )}

                  {['ISSUED', 'VIEWED', 'PARTIALLY_ACCEPTED'].includes(selectedQuote.status) && (
                    <button
                      onClick={() => handleAcceptQuote(selectedQuote.id)}
                      disabled={actionLoading}
                      className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition shadow-md shadow-emerald-600/25"
                    >
                      <ShieldCheck className="w-4 h-4" />
                      <span>Authorize Selected Line Items (Customer)</span>
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="p-8 bg-slate-900/40 border border-dashed border-slate-800 rounded-xl text-center">
                <FileText className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                <p className="text-xs text-slate-400">Select a quote to review item details and customer line-item authorizations.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL: NEW BOOKING REQUEST */}
      {showNewBookingModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Calendar className="w-5 h-5 text-indigo-400" />
                <span>Book Service Appointment</span>
              </h3>
              <button
                onClick={() => setShowNewBookingModal(false)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateBooking} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Service Offering
                </label>
                <select
                  value={newBookingForm.service_offering_id}
                  onChange={(e) => setNewBookingForm((prev) => ({ ...prev, service_offering_id: e.target.value }))}
                  className="w-full bg-slate-950 border border-slate-700 text-white text-xs rounded-lg p-2.5 font-medium"
                  required
                >
                  {offerings.map((off) => (
                    <option key={off.id} value={off.id}>
                      {off.name} — {((off.base_price_minor || 0) / 100).toLocaleString()} {off.currency}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                    Delivery Mode
                  </label>
                  <select
                    value={newBookingForm.delivery_mode}
                    onChange={(e) => setNewBookingForm((prev) => ({ ...prev, delivery_mode: e.target.value }))}
                    className="w-full bg-slate-950 border border-slate-700 text-white text-xs rounded-lg p-2.5 font-medium"
                  >
                    <option value="WORKSHOP">Workshop Drop-off</option>
                    <option value="PICKUP_AND_DELIVERY">Valet Pickup & Return</option>
                    <option value="MOBILE_UNIT">Mobile Van Service</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                    Target Vehicle
                  </label>
                  <div className="p-2 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-slate-300">
                    {currentVehicle?.make} {currentVehicle?.model} ({currentVehicle?.registration_number || currentVehicle?.id})
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Customer Concerns / Symptoms
                </label>
                <input
                  type="text"
                  placeholder="e.g. Squeaking brakes on decelerating, check engine light illuminated"
                  value={newBookingForm.concerns}
                  onChange={(e) => setNewBookingForm((prev) => ({ ...prev, concerns: e.target.value }))}
                  className="w-full bg-slate-950 border border-slate-700 text-white text-xs rounded-lg p-2.5 font-medium"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Additional Notes
                </label>
                <textarea
                  rows={2}
                  placeholder="Any access instructions or preferred contact methods..."
                  value={newBookingForm.customer_notes}
                  onChange={(e) => setNewBookingForm((prev) => ({ ...prev, customer_notes: e.target.value }))}
                  className="w-full bg-slate-950 border border-slate-700 text-white text-xs rounded-lg p-2.5 font-medium"
                />
              </div>

              <div className="pt-2 flex justify-end gap-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowNewBookingModal(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-4 py-2 text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition"
                >
                  Confirm Booking Request
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: RESCHEDULE PROPOSAL */}
      {showRescheduleModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Clock className="w-5 h-5 text-indigo-400" />
                <span>Propose Reschedule</span>
              </h3>
              <button onClick={() => setShowRescheduleModal(false)} className="text-slate-400 hover:text-white p-1">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleProposeReschedule} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Proposed Start Date/Time
                </label>
                <input
                  type="datetime-local"
                  value={rescheduleForm.proposed_start_at.slice(0, 16)}
                  onChange={(e) =>
                    setRescheduleForm((prev) => ({
                      ...prev,
                      proposed_start_at: new Date(e.target.value).toISOString(),
                      proposed_end_at: new Date(new Date(e.target.value).getTime() + 3600000).toISOString(),
                    }))
                  }
                  className="w-full bg-slate-950 border border-slate-700 text-white text-xs rounded-lg p-2.5 font-medium"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Reason for Revision
                </label>
                <textarea
                  rows={2}
                  value={rescheduleForm.reason}
                  onChange={(e) => setRescheduleForm((prev) => ({ ...prev, reason: e.target.value }))}
                  className="w-full bg-slate-950 border border-slate-700 text-white text-xs rounded-lg p-2.5 font-medium"
                  required
                />
              </div>

              <div className="pt-2 flex justify-end gap-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowRescheduleModal(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-4 py-2 text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition"
                >
                  Send Proposal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: NEW QUOTE CREATION */}
      {showNewQuoteModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-xl w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-indigo-400" />
                <span>Create Service Quote (Provider)</span>
              </h3>
              <button onClick={() => setShowNewQuoteModal(false)} className="text-slate-400 hover:text-white p-1">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateQuote} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Quote Title
                </label>
                <input
                  type="text"
                  value={newQuoteForm.title}
                  onChange={(e) => setNewQuoteForm((prev) => ({ ...prev, title: e.target.value }))}
                  className="w-full bg-slate-950 border border-slate-700 text-white text-xs rounded-lg p-2.5 font-medium"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                    Currency
                  </label>
                  <input
                    type="text"
                    value={newQuoteForm.currency}
                    readOnly
                    className="w-full bg-slate-950 border border-slate-800 text-slate-400 text-xs rounded-lg p-2.5 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                    Validity (Days)
                  </label>
                  <input
                    type="number"
                    value={newQuoteForm.expires_in_days}
                    onChange={(e) => setNewQuoteForm((prev) => ({ ...prev, expires_in_days: Number(e.target.value) }))}
                    className="w-full bg-slate-950 border border-slate-700 text-white text-xs rounded-lg p-2.5 font-medium"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Line Items Included
                </label>
                <div className="space-y-2 max-h-48 overflow-y-auto p-2 bg-slate-950 rounded-lg border border-slate-800">
                  {newQuoteForm.line_items.map((li, idx) => (
                    <div key={idx} className="p-2 bg-slate-900 rounded border border-slate-800 flex justify-between text-xs">
                      <div>
                        <span className="font-bold text-white">{li.description}</span>
                        <div className="text-[10px] text-slate-400 font-mono">
                          {li.line_item_type} • {li.is_mandatory ? 'MANDATORY' : 'RECOMMENDED'}
                        </div>
                      </div>
                      <span className="font-mono text-emerald-400 font-bold">
                        {(li.unit_price_minor / 100).toLocaleString()} KES
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowNewQuoteModal(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-4 py-2 text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition"
                >
                  Save Draft Quote
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
