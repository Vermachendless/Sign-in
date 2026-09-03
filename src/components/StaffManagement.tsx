import React, { useState, useEffect, useCallback } from 'react';
import {
  Users,
  UserPlus,
  Search,
  Filter,
  Eye,
  Edit2,
  UserX,
  UserCheck,
  Calendar,
  Phone,
  Building,
  Mail,
  X,
  AlertCircle,
  CheckCircle2,
  Clock,
  Shield,
  RefreshCw,
} from 'lucide-react';
import { StaffListItem, StaffDetailResponse, UserRole, UserStatus } from '../types/index.ts';
import { useAuth } from '../context/AuthContext.tsx';

interface StaffManagementProps {
  onStaffUpdated?: () => void;
}

export const StaffManagement: React.FC<StaffManagementProps> = ({ onStaffUpdated }) => {
  const { user: currentUser } = useAuth();
  const [staffList, setStaffList] = useState<StaffListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');

  // Modals
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<StaffListItem | null>(null);
  const [viewingStaffId, setViewingStaffId] = useState<string | null>(null);
  const [staffDetail, setStaffDetail] = useState<StaffDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Status Action Modal
  const [statusActionTarget, setStatusActionTarget] = useState<{
    staff: StaffListItem;
    newStatus: UserStatus;
  } | null>(null);
  const [actionSubmitting, setActionSubmitting] = useState(false);

  // Form states for Create
  const [createForm, setCreateForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    phone: '',
    department: '',
    role: UserRole.STAFF,
  });
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSubmitting, setCreateSubmitting] = useState(false);

  // Form states for Edit
  const [editForm, setEditForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    department: '',
    role: UserRole.STAFF,
  });
  const [editError, setEditError] = useState<string | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);

  const fetchStaff = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.append('search', searchQuery.trim());
      if (statusFilter !== 'ALL') params.append('status', statusFilter);
      if (roleFilter !== 'ALL') params.append('role', roleFilter);

      const res = await fetch(`/api/admin/staff?${params.toString()}`);
      const json = await res.json();
      if (res.ok && json.success && json.data) {
        setStaffList(json.data.staff || []);
      } else {
        setError(json.message || 'Failed to load staff list.');
      }
    } catch {
      setError('Network error loading staff directory.');
    } finally {
      setLoading(false);
    }
  }, [searchQuery, statusFilter, roleFilter]);

  useEffect(() => {
    fetchStaff();
  }, [fetchStaff]);

  const handleOpenDetail = async (id: string) => {
    setViewingStaffId(id);
    setDetailLoading(true);
    setStaffDetail(null);
    try {
      const res = await fetch(`/api/admin/staff/${id}`);
      const json = await res.json();
      if (res.ok && json.success && json.data) {
        setStaffDetail(json.data);
      }
    } catch (err) {
      console.error('Failed to load staff detail:', err);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleOpenEdit = (staff: StaffListItem) => {
    setEditingStaff(staff);
    setEditForm({
      firstName: staff.firstName,
      lastName: staff.lastName,
      email: staff.email,
      phone: staff.phone || '',
      department: staff.department || '',
      role: staff.role,
    });
    setEditError(null);
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setCreateSubmitting(true);

    try {
      const res = await fetch('/api/admin/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createForm),
      });
      const json = await res.json();

      if (res.ok && json.success) {
        setIsCreateOpen(false);
        setCreateForm({
          firstName: '',
          lastName: '',
          email: '',
          password: '',
          phone: '',
          department: '',
          role: UserRole.STAFF,
        });
        fetchStaff();
        if (onStaffUpdated) onStaffUpdated();
      } else {
        setCreateError(json.message || 'Failed to create staff member.');
      }
    } catch {
      setCreateError('Network error submitting staff creation.');
    } finally {
      setCreateSubmitting(false);
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStaff) return;
    setEditError(null);
    setEditSubmitting(true);

    try {
      const res = await fetch(`/api/admin/staff/${editingStaff.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });
      const json = await res.json();

      if (res.ok && json.success) {
        setEditingStaff(null);
        fetchStaff();
        if (onStaffUpdated) onStaffUpdated();
      } else {
        setEditError(json.message || 'Failed to update staff member.');
      }
    } catch {
      setEditError('Network error submitting staff update.');
    } finally {
      setEditSubmitting(false);
    }
  };

  const handleStatusChangeSubmit = async () => {
    if (!statusActionTarget) return;
    setActionSubmitting(true);
    try {
      const res = await fetch(`/api/admin/staff/${statusActionTarget.staff.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: statusActionTarget.newStatus }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setStatusActionTarget(null);
        fetchStaff();
        if (onStaffUpdated) onStaffUpdated();
      } else {
        alert(json.message || 'Failed to update account status.');
      }
    } catch {
      alert('Network error updating account status.');
    } finally {
      setActionSubmitting(false);
    }
  };

  const isSuperAdmin = currentUser?.role === UserRole.SUPER_ADMIN;

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="bg-white rounded-2xl border border-brand-border p-6 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-brand-black flex items-center gap-2">
              <Users className="w-5 h-5 text-brand-yellow" />
              Staff Directory &amp; Accounts
            </h2>
            <p className="text-xs text-brand-muted mt-0.5">
              Manage employee profiles, credentials, access status, and RBAC roles.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              id="refresh-staff-btn"
              onClick={() => fetchStaff()}
              disabled={loading}
              className="p-2 rounded-xl text-brand-black hover:bg-neutral-100 border border-brand-border transition cursor-pointer"
              title="Refresh Staff List"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-brand-yellow' : ''}`} />
            </button>

            <button
              id="create-staff-btn"
              onClick={() => {
                setCreateError(null);
                setIsCreateOpen(true);
              }}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-yellow hover:bg-brand-yellow-hover text-brand-black text-sm font-bold shadow-xs transition cursor-pointer"
            >
              <UserPlus className="w-4 h-4" />
              <span>Add New Staff</span>
            </button>
          </div>
        </div>

        {/* Filter Toolbar */}
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3 pt-4 border-t border-brand-border">
          {/* Search Input */}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted" />
            <input
              id="staff-search-input"
              type="text"
              placeholder="Search by name, email, department..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm bg-brand-bg border border-brand-border rounded-xl text-brand-black focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-yellow focus:border-brand-yellow"
            />
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-brand-muted shrink-0" />
            <select
              id="staff-status-filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full py-2 px-3 text-sm bg-brand-bg border border-brand-border rounded-xl text-brand-black focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-yellow focus:border-brand-yellow"
            >
              <option value="ALL">All Statuses</option>
              <option value="ACTIVE">Active Only</option>
              <option value="SUSPENDED">Suspended Only</option>
            </select>
          </div>

          {/* Role Filter */}
          <div>
            <select
              id="staff-role-filter"
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="w-full py-2 px-3 text-sm bg-brand-bg border border-brand-border rounded-xl text-brand-black focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-yellow focus:border-brand-yellow"
            >
              <option value="ALL">All Roles</option>
              <option value="STAFF">Staff Only</option>
              <option value="ADMIN">Administrators Only</option>
            </select>
          </div>
        </div>
      </div>

      {/* Staff Table */}
      <div className="bg-white rounded-2xl border border-brand-border shadow-xs overflow-hidden">
        {error && (
          <div className="p-4 bg-rose-50 border-b border-rose-200 text-rose-800 text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="bg-brand-bg border-b border-brand-border text-xs font-semibold text-brand-black uppercase tracking-wider">
                <th className="py-3 px-4">Staff Member</th>
                <th className="py-3 px-4">Department</th>
                <th className="py-3 px-4">Role</th>
                <th className="py-3 px-4">Account Status</th>
                <th className="py-3 px-4">Total Days</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-border">
              {loading && staffList.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-brand-muted">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-brand-yellow" />
                    Loading staff records...
                  </td>
                </tr>
              ) : staffList.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-brand-muted">
                    No staff records found matching your criteria.
                  </td>
                </tr>
              ) : (
                staffList.map((staff) => {
                  const isActive = staff.status === UserStatus.ACTIVE;
                  const isSelf = currentUser?.id === staff.id;
                  const canManage = isSuperAdmin || (currentUser?.role === UserRole.ADMIN && staff.role === UserRole.STAFF);

                  return (
                    <tr key={staff.id} className="hover:bg-amber-50/40 transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-brand-black">
                          {staff.firstName} {staff.lastName}
                        </div>
                        <div className="text-xs text-brand-muted">{staff.email}</div>
                        {staff.phone && <div className="text-[11px] text-brand-muted">{staff.phone}</div>}
                      </td>

                      <td className="py-3.5 px-4 text-neutral-800">
                        {staff.department ? (
                          <span className="inline-flex items-center gap-1 text-xs bg-brand-bg text-brand-black border border-brand-border px-2.5 py-1 rounded-md">
                            <Building className="w-3 h-3 text-brand-muted" />
                            {staff.department}
                          </span>
                        ) : (
                          <span className="text-xs text-brand-muted">General</span>
                        )}
                      </td>

                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                            staff.role === UserRole.SUPER_ADMIN
                              ? 'bg-neutral-900 text-brand-yellow border border-brand-yellow/30'
                              : staff.role === UserRole.ADMIN
                              ? 'bg-blue-100 text-blue-900 border border-blue-200'
                              : 'bg-emerald-100 text-emerald-900 border border-emerald-200'
                          }`}
                        >
                          <Shield className="w-3 h-3" />
                          {staff.role}
                        </span>
                      </td>

                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                            isActive
                              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                              : 'bg-rose-50 text-rose-800 border border-rose-200'
                          }`}
                        >
                          {isActive ? <UserCheck className="w-3 h-3" /> : <UserX className="w-3 h-3" />}
                          {staff.status}
                        </span>
                      </td>

                      <td className="py-3.5 px-4 text-neutral-800">
                        <span className="font-semibold text-brand-black">{staff.totalAttendedDays}</span>
                        <span className="text-xs text-brand-muted ml-1">days</span>
                      </td>

                      <td className="py-3.5 px-4 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          {/* View Profile Detail */}
                          <button
                            id={`view-staff-${staff.id}`}
                            onClick={() => handleOpenDetail(staff.id)}
                            className="p-1.5 rounded-lg text-brand-muted hover:text-brand-black hover:bg-neutral-100 border border-brand-border transition cursor-pointer"
                            title="View Staff Profile & History"
                          >
                            <Eye className="w-4 h-4" />
                          </button>

                          {/* Edit Staff Profile */}
                          {canManage && (
                            <button
                              id={`edit-staff-${staff.id}`}
                              onClick={() => handleOpenEdit(staff)}
                              className="p-1.5 rounded-lg text-brand-muted hover:text-brand-black hover:bg-neutral-100 border border-brand-border transition cursor-pointer"
                              title="Edit Staff Member"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                          )}

                          {/* Suspend / Reactivate */}
                          {canManage && !isSelf && (
                            <button
                              id={`toggle-status-staff-${staff.id}`}
                              onClick={() =>
                                setStatusActionTarget({
                                  staff,
                                  newStatus: isActive ? UserStatus.SUSPENDED : UserStatus.ACTIVE,
                                })
                              }
                              className={`p-1.5 rounded-lg border transition cursor-pointer ${
                                isActive
                                  ? 'text-brand-muted hover:text-rose-600 hover:bg-rose-50 border-brand-border'
                                  : 'text-emerald-700 hover:bg-emerald-50 border-emerald-200'
                              }`}
                              title={isActive ? 'Suspend Account' : 'Reactivate Account'}
                            >
                              {isActive ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* CREATE STAFF MODAL */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-black/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl border border-brand-border shadow-xl max-w-lg w-full p-6 relative animate-in fade-in zoom-in-95">
            <button
              onClick={() => setIsCreateOpen(false)}
              className="absolute top-4 right-4 text-brand-muted hover:text-brand-black p-1.5 rounded-lg hover:bg-neutral-100 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-lg font-bold text-brand-black flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-brand-yellow" />
              Add New Staff Account
            </h3>
            <p className="text-xs text-brand-muted mt-1 mb-4">
              Create an authenticated staff account. Passwords are securely hashed on the server.
            </p>

            {createError && (
              <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {createError}
              </div>
            )}

            <form onSubmit={handleCreateSubmit} className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-brand-black mb-1">First Name *</label>
                  <input
                    id="create-first-name"
                    type="text"
                    required
                    placeholder="e.g. Samuel"
                    value={createForm.firstName}
                    onChange={(e) => setCreateForm({ ...createForm, firstName: e.target.value })}
                    className="w-full px-3 py-2 border border-brand-border rounded-xl focus:ring-2 focus:ring-brand-yellow focus:border-brand-yellow focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-brand-black mb-1">Last Name *</label>
                  <input
                    id="create-last-name"
                    type="text"
                    required
                    placeholder="e.g. Adebayo"
                    value={createForm.lastName}
                    onChange={(e) => setCreateForm({ ...createForm, lastName: e.target.value })}
                    className="w-full px-3 py-2 border border-brand-border rounded-xl focus:ring-2 focus:ring-brand-yellow focus:border-brand-yellow focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-brand-black mb-1">Email Address *</label>
                <input
                  id="create-email"
                  type="email"
                  required
                  placeholder="samuel.adebayo@example.com"
                  value={createForm.email}
                  onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                  className="w-full px-3 py-2 border border-brand-border rounded-xl focus:ring-2 focus:ring-brand-yellow focus:border-brand-yellow focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-brand-black mb-1">Initial Password * (min 8 chars)</label>
                <input
                  id="create-password"
                  type="password"
                  required
                  placeholder="••••••••••••"
                  value={createForm.password}
                  onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                  className="w-full px-3 py-2 border border-brand-border rounded-xl focus:ring-2 focus:ring-brand-yellow focus:border-brand-yellow focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-brand-black mb-1">Department</label>
                  <input
                    id="create-department"
                    type="text"
                    placeholder="e.g. Engineering"
                    value={createForm.department}
                    onChange={(e) => setCreateForm({ ...createForm, department: e.target.value })}
                    className="w-full px-3 py-2 border border-brand-border rounded-xl focus:ring-2 focus:ring-brand-yellow focus:border-brand-yellow focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-brand-black mb-1">Phone Number</label>
                  <input
                    id="create-phone"
                    type="text"
                    placeholder="+234 800 000 0000"
                    value={createForm.phone}
                    onChange={(e) => setCreateForm({ ...createForm, phone: e.target.value })}
                    className="w-full px-3 py-2 border border-brand-border rounded-xl focus:ring-2 focus:ring-brand-yellow focus:border-brand-yellow focus:outline-none"
                  />
                </div>
              </div>

              {isSuperAdmin && (
                <div>
                  <label className="block text-xs font-semibold text-brand-black mb-1">Assigned Role</label>
                  <select
                    id="create-role"
                    value={createForm.role}
                    onChange={(e) => setCreateForm({ ...createForm, role: e.target.value as UserRole })}
                    className="w-full px-3 py-2 border border-brand-border rounded-xl focus:ring-2 focus:ring-brand-yellow focus:border-brand-yellow focus:outline-none"
                  >
                    <option value={UserRole.STAFF}>STAFF</option>
                    <option value={UserRole.ADMIN}>ADMIN</option>
                  </select>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t border-brand-border">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="px-4 py-2 rounded-xl text-brand-black hover:bg-neutral-100 font-semibold transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  id="create-submit-btn"
                  type="submit"
                  disabled={createSubmitting}
                  className="px-4 py-2 rounded-xl bg-brand-yellow hover:bg-brand-yellow-hover text-brand-black font-bold shadow-xs transition disabled:opacity-50 cursor-pointer"
                >
                  {createSubmitting ? 'Creating Account...' : 'Create Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT STAFF MODAL */}
      {editingStaff && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-black/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl border border-brand-border shadow-xl max-w-lg w-full p-6 relative animate-in fade-in zoom-in-95">
            <button
              onClick={() => setEditingStaff(null)}
              className="absolute top-4 right-4 text-brand-muted hover:text-brand-black p-1.5 rounded-lg hover:bg-neutral-100 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-lg font-bold text-brand-black flex items-center gap-2">
              <Edit2 className="w-5 h-5 text-brand-black" />
              Edit Staff Profile
            </h3>
            <p className="text-xs text-brand-muted mt-1 mb-4">
              Modify details for {editingStaff.firstName} {editingStaff.lastName}.
            </p>

            {editError && (
              <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {editError}
              </div>
            )}

            <form onSubmit={handleEditSubmit} className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-brand-black mb-1">First Name *</label>
                  <input
                    id="edit-first-name"
                    type="text"
                    required
                    value={editForm.firstName}
                    onChange={(e) => setEditForm({ ...editForm, firstName: e.target.value })}
                    className="w-full px-3 py-2 border border-brand-border rounded-xl focus:ring-2 focus:ring-brand-yellow focus:border-brand-yellow focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-brand-black mb-1">Last Name *</label>
                  <input
                    id="edit-last-name"
                    type="text"
                    required
                    value={editForm.lastName}
                    onChange={(e) => setEditForm({ ...editForm, lastName: e.target.value })}
                    className="w-full px-3 py-2 border border-brand-border rounded-xl focus:ring-2 focus:ring-brand-yellow focus:border-brand-yellow focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-brand-black mb-1">Email Address *</label>
                <input
                  id="edit-email"
                  type="email"
                  required
                  value={editForm.email}
                  onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                  className="w-full px-3 py-2 border border-brand-border rounded-xl focus:ring-2 focus:ring-brand-yellow focus:border-brand-yellow focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-brand-black mb-1">Department</label>
                  <input
                    id="edit-department"
                    type="text"
                    placeholder="e.g. Operations"
                    value={editForm.department}
                    onChange={(e) => setEditForm({ ...editForm, department: e.target.value })}
                    className="w-full px-3 py-2 border border-brand-border rounded-xl focus:ring-2 focus:ring-brand-yellow focus:border-brand-yellow focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-brand-black mb-1">Phone Number</label>
                  <input
                    id="edit-phone"
                    type="text"
                    placeholder="+234 800 000 0000"
                    value={editForm.phone}
                    onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                    className="w-full px-3 py-2 border border-brand-border rounded-xl focus:ring-2 focus:ring-brand-yellow focus:border-brand-yellow focus:outline-none"
                  />
                </div>
              </div>

              {isSuperAdmin && (
                <div>
                  <label className="block text-xs font-semibold text-brand-black mb-1">Assigned Role</label>
                  <select
                    id="edit-role"
                    value={editForm.role}
                    onChange={(e) => setEditForm({ ...editForm, role: e.target.value as UserRole })}
                    className="w-full px-3 py-2 border border-brand-border rounded-xl focus:ring-2 focus:ring-brand-yellow focus:border-brand-yellow focus:outline-none"
                  >
                    <option value={UserRole.STAFF}>STAFF</option>
                    <option value={UserRole.ADMIN}>ADMIN</option>
                  </select>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t border-brand-border">
                <button
                  type="button"
                  onClick={() => setEditingStaff(null)}
                  className="px-4 py-2 rounded-xl text-brand-black hover:bg-neutral-100 font-semibold transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  id="edit-submit-btn"
                  type="submit"
                  disabled={editSubmitting}
                  className="px-4 py-2 rounded-xl bg-brand-yellow hover:bg-brand-yellow-hover text-brand-black font-bold shadow-xs transition disabled:opacity-50 cursor-pointer"
                >
                  {editSubmitting ? 'Saving Changes...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* STAFF DETAIL / HISTORY MODAL */}
      {viewingStaffId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-black/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl border border-brand-border shadow-xl max-w-2xl w-full p-6 relative animate-in fade-in zoom-in-95 max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setViewingStaffId(null)}
              className="absolute top-4 right-4 text-brand-muted hover:text-brand-black p-1.5 rounded-lg hover:bg-neutral-100 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            {detailLoading || !staffDetail ? (
              <div className="py-16 text-center text-brand-muted">
                <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-brand-yellow" />
                Loading staff profile and attendance records...
              </div>
            ) : (
              <div className="space-y-6">
                {/* Profile Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-brand-border">
                  <div>
                    <h3 className="text-xl font-bold text-brand-black">
                      {staffDetail.user.firstName} {staffDetail.user.lastName}
                    </h3>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-brand-muted mt-1">
                      <span className="flex items-center gap-1">
                        <Mail className="w-3.5 h-3.5 text-brand-muted" /> {staffDetail.user.email}
                      </span>
                      {staffDetail.user.phone && (
                        <span className="flex items-center gap-1">
                          <Phone className="w-3.5 h-3.5 text-brand-muted" /> {staffDetail.user.phone}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Building className="w-3.5 h-3.5 text-brand-muted" /> {staffDetail.user.department || 'General'}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${
                        staffDetail.user.status === UserStatus.ACTIVE
                          ? 'bg-emerald-100 text-emerald-900 border border-emerald-200'
                          : 'bg-rose-100 text-rose-900 border border-rose-200'
                      }`}
                    >
                      {staffDetail.user.status === UserStatus.ACTIVE ? (
                        <UserCheck className="w-3.5 h-3.5" />
                      ) : (
                        <UserX className="w-3.5 h-3.5" />
                      )}
                      {staffDetail.user.status}
                    </span>
                  </div>
                </div>

                {/* Lifetime Stats */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div className="p-3 bg-brand-bg rounded-xl border border-brand-border">
                    <div className="text-xs text-brand-muted">Days Attended</div>
                    <div className="text-xl font-bold text-brand-black mt-0.5">
                      {staffDetail.stats.totalAttendedDays}
                    </div>
                  </div>

                  <div className="p-3 bg-brand-bg rounded-xl border border-brand-border">
                    <div className="text-xs text-brand-muted">Completed Days</div>
                    <div className="text-xl font-bold text-brand-black mt-0.5">
                      {staffDetail.stats.totalCheckedOutDays}
                    </div>
                  </div>

                  <div className="p-3 bg-brand-bg rounded-xl border border-brand-border col-span-2 sm:col-span-1">
                    <div className="text-xs text-brand-muted">Account Created</div>
                    <div className="text-xs font-semibold text-brand-black mt-1">
                      {new Date(staffDetail.user.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                </div>

                {/* Recent Attendance History */}
                <div>
                  <h4 className="text-sm font-bold text-brand-black mb-3 flex items-center gap-2">
                    <Clock className="w-4 h-4 text-brand-yellow" />
                    Recent Attendance Records
                  </h4>

                  {staffDetail.recentAttendance.length === 0 ? (
                    <div className="p-6 text-center text-xs text-brand-muted bg-brand-bg rounded-xl border border-brand-border">
                      No past attendance history found for this staff member.
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-xl border border-brand-border">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-brand-bg text-brand-black font-semibold border-b border-brand-border">
                            <th className="py-2.5 px-3">Date</th>
                            <th className="py-2.5 px-3">Check-In</th>
                            <th className="py-2.5 px-3">Check-Out</th>
                            <th className="py-2.5 px-3">Duration</th>
                            <th className="py-2.5 px-3">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-brand-border">
                          {staffDetail.recentAttendance.map((rec) => (
                            <tr key={rec.id} className="hover:bg-amber-50/40">
                              <td className="py-2.5 px-3 font-medium text-brand-black flex items-center gap-1.5">
                                <Calendar className="w-3.5 h-3.5 text-brand-muted" />
                                {rec.date}
                              </td>
                              <td className="py-2.5 px-3 text-neutral-800">{rec.formattedCheckIn}</td>
                              <td className="py-2.5 px-3 text-neutral-800">{rec.formattedCheckOut}</td>
                              <td className="py-2.5 px-3 font-semibold text-brand-black">{rec.workingDuration}</td>
                              <td className="py-2.5 px-3">
                                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-900 bg-emerald-100 px-2 py-0.5 rounded-full border border-emerald-200">
                                  <CheckCircle2 className="w-3 h-3" />
                                  {rec.status}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUSPEND / REACTIVATE CONFIRMATION MODAL */}
      {statusActionTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-black/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl border border-brand-border shadow-xl max-w-md w-full p-6 relative animate-in fade-in zoom-in-95">
            <h3 className="text-lg font-bold text-brand-black flex items-center gap-2">
              {statusActionTarget.newStatus === UserStatus.SUSPENDED ? (
                <>
                  <UserX className="w-5 h-5 text-rose-600" /> Suspend Staff Account
                </>
              ) : (
                <>
                  <UserCheck className="w-5 h-5 text-emerald-600" /> Reactivate Staff Account
                </>
              )}
            </h3>

            <p className="text-xs text-neutral-700 mt-2">
              Are you sure you want to mark{' '}
              <span className="font-bold text-brand-black">
                {statusActionTarget.staff.firstName} {statusActionTarget.staff.lastName}
              </span>{' '}
              as <span className="font-bold">{statusActionTarget.newStatus}</span>?
            </p>

            {statusActionTarget.newStatus === UserStatus.SUSPENDED && (
              <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-xs">
                All active login sessions for this user will be immediately invalidated. Historical attendance records will remain preserved.
              </div>
            )}

            <div className="flex justify-end gap-3 mt-6">
              <button
                type="button"
                onClick={() => setStatusActionTarget(null)}
                className="px-4 py-2 rounded-xl text-brand-black hover:bg-neutral-100 text-sm font-semibold transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                id="confirm-status-btn"
                type="button"
                disabled={actionSubmitting}
                onClick={handleStatusChangeSubmit}
                className={`px-4 py-2 rounded-xl text-white text-sm font-bold shadow-xs transition cursor-pointer ${
                  statusActionTarget.newStatus === UserStatus.SUSPENDED
                    ? 'bg-rose-600 hover:bg-rose-700'
                    : 'bg-emerald-600 hover:bg-emerald-700'
                }`}
              >
                {actionSubmitting ? 'Processing...' : 'Confirm Action'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
