'use client';

import { useState, useEffect } from 'react';
import {
  Card,
  CardHeader,
  CardBody,
  Divider,
  Button,
  Input,
  Chip,
  Skeleton,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Switch,
  useDisclosure,
} from '@heroui/react';
import { Trash2, Plus, Radio, Lock, Unlock, AlertCircle, ChevronDown, ChevronRight, ChevronUp, RefreshCw, Eye, EyeOff, UserCheck, UserX, Copy, Check, ExternalLink, Zap } from "lucide-react";
import VerificationCodeInput from './VerificationCodeInput';
import ConfirmDialog from '@/components/ConfirmDialog';
import { apiUrl } from '@/lib/api';

const isDev = process.env.NODE_ENV !== 'production';
const siteDomain = process.env.NEXT_PUBLIC_SITE_DOMAIN || 'defcon.run';
const REGION_SHORT = process.env.NEXT_PUBLIC_REGION_SHORT || 'use1';
const flashUrl = isDev ? 'http://localhost:3004' : `https://flash.${siteDomain}/${REGION_SHORT}/`;

interface MeshtasticRadio {
  id: string;
  nodeId: string;
  privateKey: string;
  publicKey?: string;
  impersonate: boolean;
  showOnMap?: boolean;
  verificationCode?: string;
  verified: boolean;
  createdAt: number;
  verifiedAt?: number;
  verificationAttempts?: number;
  resendAttempts?: number;
}

interface QuotaInfo {
  remaining: number;
  initial: number;
}

interface MeshtasticRadiosProps {
  radios?: MeshtasticRadio[];
  quotas?: {
    meshtastic_radio?: QuotaInfo;
  };
  mqttUsername?: string;
  mqttPassword?: string;
  onUpdate?: () => void;
}

export default function MeshtasticRadios({ radios: initialRadios, quotas, mqttUsername, mqttPassword, onUpdate }: MeshtasticRadiosProps) {
  const [radios, setRadios] = useState<MeshtasticRadio[]>(initialRadios || []);
  const [loading, setLoading] = useState(!initialRadios);
  const [error, setError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  // Add radio modal state
  const { isOpen: isAddOpen, onOpen: openAdd, onClose: closeAdd } = useDisclosure();
  const [addNodeId, setAddNodeId] = useState('');
  const [addPrivateKey, setAddPrivateKey] = useState('');
  const [addImpersonate, setAddImpersonate] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Verification state
  const [verificationCodes, setVerificationCodes] = useState<Record<string, string>>({});
  const [verifyingRadioId, setVerifyingRadioId] = useState<string | null>(null);
  const [resendingRadioId, setResendingRadioId] = useState<string | null>(null);

  // Delete state
  const [deletingRadioId, setDeletingRadioId] = useState<string | null>(null);
  const [radioToDelete, setRadioToDelete] = useState<MeshtasticRadio | null>(null);
  const { isOpen: isDeleteOpen, onOpen: openDelete, onClose: closeDelete } = useDisclosure();

  // Impersonate toggle state
  const [togglingImpersonateId, setTogglingImpersonateId] = useState<string | null>(null);

  // Show on map toggle state
  const [togglingShowOnMapId, setTogglingShowOnMapId] = useState<string | null>(null);

  // Private key visibility state
  const [visiblePrivateKeys, setVisiblePrivateKeys] = useState<Record<string, boolean>>({});

  // Public key visibility state
  const [visiblePublicKeys, setVisiblePublicKeys] = useState<Record<string, boolean>>({});

  // MQTT credential visibility
  const [mqttVisible, setMqttVisible] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const copyToClipboard = (value: string, field: string) => {
    navigator.clipboard.writeText(value);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1500);
  };

  // Get quota values with defaults
  const radioQuota = quotas?.meshtastic_radio;
  const [remaining, setRemaining] = useState(radioQuota?.remaining ?? 5);
  const initial = radioQuota?.initial ?? 5;

  useEffect(() => {
    if (radioQuota) {
      setRemaining(radioQuota.remaining);
    }
  }, [radioQuota]);

  useEffect(() => {
    if (!initialRadios) {
      fetchRadios();
    }
  }, [initialRadios]);

  const fetchRadios = async () => {
    try {
      const response = await fetch(apiUrl('/api/meshtastic-radios'));
      if (!response.ok) throw new Error('Failed to fetch radios');
      const data = await response.json();
      setRadios(data.radios || []);
      if (data.quota) {
        setRemaining(data.quota.remaining);
      }
    } catch (err) {
      setError('Failed to load radios');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddRadio = async () => {
    if (!addNodeId.trim()) {
      setAddError('Node ID is required');
      return;
    }

    setIsAdding(true);
    setAddError(null);

    try {
      const response = await fetch(apiUrl('/api/meshtastic-radios'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodeId: addNodeId,
          privateKey: addPrivateKey,
          impersonate: addImpersonate,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setAddError(data.error || 'Failed to add radio');
        return;
      }

      // Add new radio to list
      setRadios(prev => [...prev, data.radio]);
      if (data.quota) {
        setRemaining(data.quota.remaining);
      }

      // Reset form and close modal
      setAddNodeId('');
      setAddPrivateKey('');
      setAddImpersonate(false);
      closeAdd();
      setIsExpanded(true);

      // Notify parent to refresh
      onUpdate?.();
    } catch (err) {
      setAddError('Failed to add radio');
      console.error(err);
    } finally {
      setIsAdding(false);
    }
  };

  const handleVerifyRadio = async (radioId: string) => {
    const code = verificationCodes[radioId];
    if (!code || code.length !== 6) {
      return;
    }

    setVerifyingRadioId(radioId);

    try {
      const response = await fetch(apiUrl('/api/meshtastic-radios'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          radioId,
          verificationCode: code,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        // Update the radio to show failed attempt
        if (data.attemptsRemaining !== undefined) {
          setRadios(prev => prev.map(r =>
            r.id === radioId
              ? { ...r, verificationAttempts: 5 - data.attemptsRemaining }
              : r
          ));
        }
        setError(data.error || 'Verification failed');
        return;
      }

      // Update radio in list
      setRadios(prev => prev.map(r =>
        r.id === radioId ? { ...r, ...data.radio, verified: true } : r
      ));

      // Clear verification code input
      setVerificationCodes(prev => {
        const updated = { ...prev };
        delete updated[radioId];
        return updated;
      });

      onUpdate?.();
    } catch (err) {
      setError('Failed to verify radio');
      console.error(err);
    } finally {
      setVerifyingRadioId(null);
    }
  };

  const handleResendCode = async (radioId: string) => {
    setResendingRadioId(radioId);

    try {
      const response = await fetch(apiUrl('/api/meshtastic-radios/resend'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ radioId }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Failed to resend code');
        return;
      }

      // Update resend attempts in local state
      setRadios(prev => prev.map(r =>
        r.id === radioId
          ? { ...r, resendAttempts: 3 - (data.resendsRemaining || 0) }
          : r
      ));
    } catch (err) {
      setError('Failed to resend code');
      console.error(err);
    } finally {
      setResendingRadioId(null);
    }
  };

  const confirmDeleteRadio = (radio: MeshtasticRadio) => {
    setRadioToDelete(radio);
    openDelete();
  };

  const handleDeleteRadio = async () => {
    if (!radioToDelete) return;

    const radioId = radioToDelete.id;
    setDeletingRadioId(radioId);

    try {
      const response = await fetch(apiUrl(`/api/meshtastic-radios?radioId=${radioId}`), {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error || 'Failed to delete radio');
        return;
      }

      // Remove radio from list (quota is NOT restored - lifetime limit)
      setRadios(prev => prev.filter(r => r.id !== radioId));

      onUpdate?.();
      closeDelete();
    } catch (err) {
      setError('Failed to delete radio');
      console.error(err);
    } finally {
      setDeletingRadioId(null);
      setRadioToDelete(null);
    }
  };

  const handleToggleImpersonate = async (radioId: string, currentValue: boolean) => {
    setTogglingImpersonateId(radioId);

    try {
      const response = await fetch(apiUrl('/api/meshtastic-radios'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          radioId,
          impersonate: !currentValue,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Failed to update radio');
        return;
      }

      // Update radio in list
      setRadios(prev => prev.map(r =>
        r.id === radioId ? { ...r, impersonate: !currentValue } : r
      ));

      onUpdate?.();
    } catch (err) {
      setError('Failed to update radio');
      console.error(err);
    } finally {
      setTogglingImpersonateId(null);
    }
  };

  const handleToggleShowOnMap = async (radioId: string, currentValue: boolean) => {
    setTogglingShowOnMapId(radioId);

    try {
      const response = await fetch(apiUrl('/api/meshtastic-radios'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          radioId,
          showOnMap: !currentValue,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Failed to update radio');
        return;
      }

      // Update radio in list
      setRadios(prev => prev.map(r =>
        r.id === radioId ? { ...r, showOnMap: !currentValue } : r
      ));

      onUpdate?.();
    } catch (err) {
      setError('Failed to update radio');
      console.error(err);
    } finally {
      setTogglingShowOnMapId(null);
    }
  };

  const togglePrivateKeyVisibility = (radioId: string) => {
    setVisiblePrivateKeys(prev => ({
      ...prev,
      [radioId]: !prev[radioId]
    }));
  };

  const togglePublicKeyVisibility = (radioId: string) => {
    setVisiblePublicKeys(prev => ({
      ...prev,
      [radioId]: !prev[radioId]
    }));
  };

  if (loading) {
    return (
      <Card className="w-full">
        <CardHeader className="flex justify-between items-center pb-2">
          <div className="flex items-center gap-2">
            <Radio className="w-5 h-5" />
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold">Meshtastic</h3>
                <Skeleton className="w-6 h-4 rounded">
                  <div className="h-4 w-6 bg-default-300"></div>
                </Skeleton>
              </div>
              <p className="text-sm text-default-500">
                Manage your Meshtastic radio connections
              </p>
            </div>
          </div>
        </CardHeader>
        <Divider />
      </Card>
    );
  }

  return (
    <>
      {/* Add Radio Modal */}
      <Modal isOpen={isAddOpen} onClose={closeAdd} size="md">
        <ModalContent>
          <ModalHeader>Add Meshtastic Radio</ModalHeader>
          <ModalBody>
            {addError && (
              <div className="bg-danger-50 border border-danger-200 text-danger-700 px-4 py-2 rounded text-sm mb-4">
                {addError}
              </div>
            )}

            {/* Auto-flash CTA — flashing a device registers it here automatically,
                so most users never need the manual Node ID entry below. */}
            <div className="flex items-center justify-between gap-3 p-3 rounded-lg bg-primary-50 border border-primary-200">
              <div>
                <p className="text-sm font-medium text-primary-700">Have a device to flash?</p>
                <p className="text-xs text-primary-600">Flash it and it registers here automatically — no manual entry needed.</p>
              </div>
              <Button
                color="primary"
                size="sm"
                as="a"
                href={flashUrl}
                target="_blank"
                rel="noopener noreferrer"
                startContent={<Zap className="h-4 w-4" />}
                endContent={<ExternalLink className="h-3 w-3" />}
                className="shrink-0"
              >
                Goto Flash
              </Button>
            </div>

            <div className="flex items-center gap-3 my-4">
              <Divider className="flex-1" />
              <span className="text-xs text-default-400">or add manually</span>
              <Divider className="flex-1" />
            </div>

            <div className="space-y-4">
              <Input
                label="Node ID"
                placeholder="!1234abcd or 305419896"
                value={addNodeId}
                onChange={(e) => setAddNodeId(e.target.value)}
                description="Enter hex format (!1234abcd) or decimal integer"
                isRequired
              />

              <div className="flex items-center justify-between p-3 bg-default-100 rounded-lg">
                <div>
                  <p className="text-sm font-medium">Enable Impersonation</p>
                  <p className="text-xs text-default-500">Allow sending messages as this radio</p>
                </div>
                <Switch
                  isSelected={addImpersonate}
                  onValueChange={setAddImpersonate}
                />
              </div>

              {addImpersonate && (
                <Input
                  label="Private Key"
                  placeholder="Base64 encoded private key"
                  value={addPrivateKey}
                  onChange={(e) => setAddPrivateKey(e.target.value)}
                  description="Required for impersonation"
                  isRequired
                />
              )}

              <div className="text-xs text-default-500 bg-warning-50 p-3 rounded-lg">
                <p className="font-medium text-warning-700 mb-1">How verification works:</p>
                <ol className="list-decimal list-inside space-y-1 text-warning-600">
                  <li>Add your radio's Node ID above</li>
                  <li>A 6-digit code will be sent to your radio via Meshtastic</li>
                  <li>Enter the code to verify ownership</li>
                </ol>
              </div>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={closeAdd} isDisabled={isAdding}>
              Cancel
            </Button>
            <Button
              color="primary"
              onPress={handleAddRadio}
              isLoading={isAdding}
              isDisabled={!addNodeId.trim() || (addImpersonate && !addPrivateKey.trim())}
            >
              Add Radio
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={isDeleteOpen}
        onClose={() => {
          closeDelete();
          setRadioToDelete(null);
        }}
        onConfirm={handleDeleteRadio}
        title="Delete Radio"
        message={
          <div className="space-y-2">
            <p>Are you sure you want to delete radio <span className="font-mono font-bold">{radioToDelete?.nodeId}</span>?</p>
            <p className="text-warning-600 text-sm font-medium">This will NOT restore your add quota.</p>
          </div>
        }
        confirmLabel="Delete"
        cancelLabel="Keep Radio"
        confirmColor="danger"
        isLoading={deletingRadioId !== null}
        icon={<Trash2 className="h-5 w-5 text-danger" />}
      />

      {/* Main Card */}
      <Card className="glass-card overflow-hidden">
        <CardBody className="px-5 py-3">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex items-center gap-2 text-left cursor-pointer hover:opacity-80 transition-opacity"
            >
              {isExpanded ? (
                <ChevronDown className="w-3.5 h-3.5 text-default-400" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-default-400" />
              )}
              <span className="font-museo text-base font-bold text-foreground">Meshtastic</span>
              <Chip
                size="sm"
                variant="flat"
                color={radios.length > 0 ? "success" : "default"}
              >
                {radios.length}
              </Chip>
            </button>
            <Button
              isIconOnly
              color="primary"
              variant="flat"
              size="lg"
              isDisabled={remaining <= 0}
              onPress={() => openAdd()}
            >
              <Plus className="h-6 w-6" />
            </Button>
          </div>
        {isExpanded && (
          <div className="space-y-4 mt-3">
            {/* MQTT Credentials */}
            {mqttUsername && (
              <div className="border border-default-200 rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-default-400">MQTT Credentials</span>
                  <Button
                    isIconOnly
                    variant="light"
                    size="sm"
                    onPress={() => setMqttVisible(!mqttVisible)}
                  >
                    {mqttVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                <div className="grid grid-cols-1 gap-3">
                  <div className="space-y-1">
                    <span className="text-xs text-default-500">Username</span>
                    <div className="flex items-center gap-2">
                      <div className={`flex rounded-md border border-default-200/50 overflow-hidden ${mqttVisible ? '' : 'blur-sm select-none'}`}>
                        {mqttUsername.split('').map((char, i) => (
                          <span key={i} className={`font-mono text-lg text-center w-7 py-1.5 bg-default-100/50 ${i > 0 ? 'border-l border-default-200/50' : ''}`}>{char}</span>
                        ))}
                      </div>
                      <Button isIconOnly variant="light" size="sm" onPress={() => copyToClipboard(mqttUsername!, 'username')}>
                        {copiedField === 'username' ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-default-500">Password</span>
                    <div className="flex items-center gap-2">
                      <div className={`flex rounded-md border border-default-200/50 overflow-hidden ${mqttVisible ? '' : 'blur-sm select-none'}`}>
                        {(mqttPassword || '—').split('').map((char, i) => (
                          <span key={i} className={`font-mono text-lg text-center w-7 py-1.5 bg-default-100/50 ${i > 0 ? 'border-l border-default-200/50' : ''}`}>{char}</span>
                        ))}
                      </div>
                      {mqttPassword && (
                        <Button isIconOnly variant="light" size="sm" onPress={() => copyToClipboard(mqttPassword!, 'password')}>
                          {copiedField === 'password' ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div className="bg-danger-50 border border-danger-200 text-danger-700 px-4 py-3 rounded relative flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" />
                  {error}
                </span>
                <Button size="sm" variant="light" onPress={() => setError(null)}>
                  Dismiss
                </Button>
              </div>
            )}

            <div className="space-y-2">
              {radios.length === 0 ? (
                <div className="text-center py-8">
                  <Radio className="w-12 h-12 mx-auto text-default-300 mb-3" />
                  <p className="text-default-500 mb-4">
                    No radios configured yet.
                  </p>
                  <div className="flex gap-2 justify-center">
                    <Button
                      color="primary"
                      as="a"
                      href={flashUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      startContent={<Zap className="h-4 w-4" />}
                      endContent={<ExternalLink className="h-3 w-3" />}
                    >
                      Flash
                    </Button>
                    <Button
                      variant="flat"
                      onPress={openAdd}
                      isDisabled={remaining <= 0}
                      startContent={<Plus className="h-4 w-4" />}
                    >
                      Manual Add
                    </Button>
                  </div>
                </div>
              ) : (
                radios.map((radio) => (
                  <div key={radio.id} className="border border-default-200 rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Radio className="h-5 w-5 text-default-500" />
                        <span className="font-mono text-lg font-semibold">{radio.nodeId}</span>
                        {radio.verified ? (
                          <Chip color="success" size="md" variant="flat" startContent={<Unlock className="h-4 w-4" />}>
                            Verified
                          </Chip>
                        ) : (
                          <Chip color="warning" size="md" variant="flat" startContent={<Lock className="h-4 w-4" />}>
                            Pending
                          </Chip>
                        )}
                        {radio.verified && radio.privateKey && (
                          <div className="flex items-center gap-1">
                            <Switch
                              size="sm"
                              color="secondary"
                              isSelected={radio.impersonate}
                              isDisabled={togglingImpersonateId === radio.id}
                              onValueChange={() => handleToggleImpersonate(radio.id, radio.impersonate)}
                              thumbIcon={radio.impersonate ? <UserCheck className="h-3 w-3" /> : <UserX className="h-3 w-3" />}
                            />
                            <span className="text-xs text-default-500">Impersonate</span>
                          </div>
                        )}
                        {radio.verified && radio.privateKey && (
                          <div className="flex items-center gap-1">
                            <Switch
                              size="sm"
                              color="success"
                              isSelected={radio.showOnMap ?? false}
                              isDisabled={togglingShowOnMapId === radio.id}
                              onValueChange={() => handleToggleShowOnMap(radio.id, radio.showOnMap ?? false)}
                            />
                            <span className="text-xs text-default-500">Show me on the map</span>
                          </div>
                        )}
                      </div>
                      <Button
                        isIconOnly
                        variant="light"
                        color="danger"
                        size="sm"
                        isLoading={deletingRadioId === radio.id}
                        onPress={() => confirmDeleteRadio(radio)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                    {!radio.verified && (
                      <div className="space-y-3 pt-3 border-t border-default-100">
                        <p className="text-xs text-center text-default-500">
                          A verification code was sent to your radio. Enter it below.
                          {(radio.verificationAttempts || 0) > 0 && (
                            <span className="text-warning-600 ml-1">
                              ({5 - (radio.verificationAttempts || 0)} attempts remaining)
                            </span>
                          )}
                        </p>
                        <VerificationCodeInput
                          value={verificationCodes[radio.id] || ''}
                          onChange={(value) => setVerificationCodes(prev => ({
                            ...prev,
                            [radio.id]: value
                          }))}
                          isDisabled={verifyingRadioId === radio.id}
                        />
                        <div className="flex gap-2 justify-center">
                          <Button
                            size="sm"
                            color="primary"
                            isLoading={verifyingRadioId === radio.id}
                            isDisabled={(verificationCodes[radio.id]?.length || 0) !== 6}
                            onPress={() => handleVerifyRadio(radio.id)}
                          >
                            Verify
                          </Button>
                          <Button
                            size="sm"
                            variant="flat"
                            isLoading={resendingRadioId === radio.id}
                            isDisabled={(radio.resendAttempts || 0) >= 3}
                            onPress={() => handleResendCode(radio.id)}
                            startContent={<RefreshCw className="h-3 w-3" />}
                          >
                            Resend
                            {(radio.resendAttempts || 0) > 0 && (
                              <span className="text-xs">({3 - (radio.resendAttempts || 0)})</span>
                            )}
                          </Button>
                        </div>
                      </div>
                    )}

                    {radio.verified && (
                      <div className="pt-2 border-t border-default-100 space-y-2">
                        <div className="flex items-center justify-between text-xs text-default-500">
                          <span>Verified: {new Date(radio.verifiedAt || radio.createdAt).toLocaleString()}</span>
                        </div>
                        {radio.privateKey && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-default-500 w-16 shrink-0">Private Key:</span>
                            <code className="text-xs font-mono bg-default-100 px-2 py-1 rounded flex-1 overflow-hidden">
                              {visiblePrivateKeys[radio.id]
                                ? radio.privateKey
                                : '••••••••••••••••••••••••'}
                            </code>
                            <Button
                              isIconOnly
                              variant="light"
                              size="sm"
                              onPress={() => togglePrivateKeyVisibility(radio.id)}
                            >
                              {visiblePrivateKeys[radio.id] ? (
                                <EyeOff className="h-4 w-4" />
                              ) : (
                                <Eye className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        )}
                        {radio.publicKey && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-default-500 w-16 shrink-0">Public Key:</span>
                            <code className="text-xs font-mono bg-default-100 px-2 py-1 rounded flex-1 overflow-hidden">
                              {visiblePublicKeys[radio.id]
                                ? radio.publicKey
                                : '••••••••••••••••••••••••'}
                            </code>
                            <Button
                              isIconOnly
                              variant="light"
                              size="sm"
                              onPress={() => togglePublicKeyVisibility(radio.id)}
                            >
                              {visiblePublicKeys[radio.id] ? (
                                <EyeOff className="h-4 w-4" />
                              ) : (
                                <Eye className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            <p className="text-xs text-default-500 text-center">
              {remaining} Add{remaining !== 1 ? 's' : ''} remaining (lifetime)
            </p>
          </div>
        )}
        </CardBody>
      </Card>
    </>
  );
}
