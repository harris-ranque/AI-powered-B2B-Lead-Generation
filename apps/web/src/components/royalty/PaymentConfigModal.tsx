import React, { useState } from 'react';
import { useMutation } from 'convex/react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CheckCircle } from 'lucide-react';
import { DeveloperConfig } from '@shared';

interface PaymentConfigModalProps {
  config: DeveloperConfig | null;
  onClose: () => void;
}

import { api } from "@genni/convex-types"

export function PaymentConfigModal({ config, onClose }: PaymentConfigModalProps) {
  const updateConfig = useMutation(api.royalty.config.updateDeveloperConfig);
  const [payoutMethod, setPayoutMethod] = useState<'automatic' | 'manual'>(config?.payoutMethod || 'manual');
  const [loading, setLoading] = useState(false);

  const [formData, setFormData] = useState({
    stripeConnectAccountId: config?.stripeConnectAccountId || '',
    bankDetails: config?.bankDetails || {
      accountName: '',
      accountNumber: '',
      routingNumber: '',
      bankName: '',
      swift: '',
    },
    paypalEmail: config?.paypalEmail || '',
    preferredPaymentMethod: config?.preferredPaymentMethod || 'bank',
    taxInfo: config?.taxInfo || {
      taxId: '',
      businessName: '',
      address: {
        street: '',
        city: '',
        state: '',
        zip: '',
        country: 'US',
      },
    },
  });

  const handleSave = async () => {
    setLoading(true);
    try {
      await updateConfig({
        payoutMethod,
        ...formData,
      });
      onClose();
    } catch (error) {
      console.error('Failed to update config:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleStripeConnect = () => {
    // Open Stripe Connect OAuth flow
    window.open('/api/stripe/connect', '_blank');
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Payment Configuration</DialogTitle>
          <DialogDescription>
            Configure how you want to receive your royalty payments
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div className="space-y-4">
            <Label>Payment Method</Label>
            <RadioGroup value={payoutMethod} onValueChange={(value) => setPayoutMethod(value as 'automatic' | 'manual')}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="automatic" id="automatic" />
                <Label htmlFor="automatic" className="flex-1">
                  <div className="font-medium">Automatic (Stripe Connect)</div>
                  <div className="text-sm text-muted-foreground">
                    Receive payments automatically on the 15th of each month
                  </div>
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="manual" id="manual" />
                <Label htmlFor="manual" className="flex-1">
                  <div className="font-medium">Manual</div>
                  <div className="text-sm text-muted-foreground">
                    View payment details and receive payments manually
                  </div>
                </Label>
              </div>
            </RadioGroup>
          </div>

          {payoutMethod === 'automatic' ? (
            <div className="space-y-4">
              <Label>Stripe Connect Setup</Label>
              {!config?.stripeConnectAccountId ? (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Click the button below to connect your Stripe account and enable automatic payments.
                  </p>
                  <Button 
                    onClick={handleStripeConnect}
                    className="w-full"
                  >
                    Connect Stripe Account
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    <span className="text-sm">Stripe account connected</span>
                  </div>
                  <Input
                    value={formData.stripeConnectAccountId}
                    disabled
                    placeholder="acct_..."
                  />
                </div>
              )}
            </div>
          ) : (
            <Tabs defaultValue="bank" className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="bank">Bank Transfer</TabsTrigger>
                <TabsTrigger value="paypal">PayPal</TabsTrigger>
                <TabsTrigger value="tax">Tax Info</TabsTrigger>
              </TabsList>

              <TabsContent value="bank" className="space-y-4">
                <div className="grid gap-4">
                  <div>
                    <Label htmlFor="accountName">Account Name</Label>
                    <Input
                      id="accountName"
                      value={formData.bankDetails.accountName}
                      onChange={(e) => setFormData({
                        ...formData,
                        bankDetails: {
                          ...formData.bankDetails,
                          accountName: e.target.value
                        }
                      })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="bankName">Bank Name</Label>
                    <Input
                      id="bankName"
                      value={formData.bankDetails.bankName}
                      onChange={(e) => setFormData({
                        ...formData,
                        bankDetails: {
                          ...formData.bankDetails,
                          bankName: e.target.value
                        }
                      })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="accountNumber">Account Number</Label>
                    <Input
                      id="accountNumber"
                      type="password"
                      value={formData.bankDetails.accountNumber}
                      onChange={(e) => setFormData({
                        ...formData,
                        bankDetails: {
                          ...formData.bankDetails,
                          accountNumber: e.target.value
                        }
                      })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="routingNumber">Routing Number</Label>
                    <Input
                      id="routingNumber"
                      value={formData.bankDetails.routingNumber}
                      onChange={(e) => setFormData({
                        ...formData,
                        bankDetails: {
                          ...formData.bankDetails,
                          routingNumber: e.target.value
                        }
                      })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="swift">SWIFT Code (International)</Label>
                    <Input
                      id="swift"
                      value={formData.bankDetails.swift}
                      onChange={(e) => setFormData({
                        ...formData,
                        bankDetails: {
                          ...formData.bankDetails,
                          swift: e.target.value
                        }
                      })}
                    />
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="paypal" className="space-y-4">
                <div>
                  <Label htmlFor="paypalEmail">PayPal Email</Label>
                  <Input
                    id="paypalEmail"
                    type="email"
                    value={formData.paypalEmail}
                    onChange={(e) => setFormData({
                      ...formData,
                      paypalEmail: e.target.value,
                      preferredPaymentMethod: 'paypal'
                    })}
                    placeholder="your@email.com"
                  />
                </div>
              </TabsContent>

              <TabsContent value="tax" className="space-y-4">
                <div className="grid gap-4">
                  <div>
                    <Label htmlFor="taxId">Tax ID / SSN</Label>
                    <Input
                      id="taxId"
                      value={formData.taxInfo.taxId}
                      onChange={(e) => setFormData({
                        ...formData,
                        taxInfo: {
                          ...formData.taxInfo,
                          taxId: e.target.value
                        }
                      })}
                      placeholder="XXX-XX-XXXX"
                    />
                  </div>
                  <div>
                    <Label htmlFor="businessName">Business Name (Optional)</Label>
                    <Input
                      id="businessName"
                      value={formData.taxInfo.businessName}
                      onChange={(e) => setFormData({
                        ...formData,
                        taxInfo: {
                          ...formData.taxInfo,
                          businessName: e.target.value
                        }
                      })}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="street">Street Address</Label>
                      <Input
                        id="street"
                        value={formData.taxInfo.address.street}
                        onChange={(e) => setFormData({
                          ...formData,
                          taxInfo: {
                            ...formData.taxInfo,
                            address: {
                              ...formData.taxInfo.address,
                              street: e.target.value
                            }
                          }
                        })}
                      />
                    </div>
                    <div>
                      <Label htmlFor="city">City</Label>
                      <Input
                        id="city"
                        value={formData.taxInfo.address.city}
                        onChange={(e) => setFormData({
                          ...formData,
                          taxInfo: {
                            ...formData.taxInfo,
                            address: {
                              ...formData.taxInfo.address,
                              city: e.target.value
                            }
                          }
                        })}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <Label htmlFor="state">State</Label>
                      <Input
                        id="state"
                        value={formData.taxInfo.address.state}
                        onChange={(e) => setFormData({
                          ...formData,
                          taxInfo: {
                            ...formData.taxInfo,
                            address: {
                              ...formData.taxInfo.address,
                              state: e.target.value
                            }
                          }
                        })}
                      />
                    </div>
                    <div>
                      <Label htmlFor="zip">ZIP Code</Label>
                      <Input
                        id="zip"
                        value={formData.taxInfo.address.zip}
                        onChange={(e) => setFormData({
                          ...formData,
                          taxInfo: {
                            ...formData.taxInfo,
                            address: {
                              ...formData.taxInfo.address,
                              zip: e.target.value
                            }
                          }
                        })}
                      />
                    </div>
                    <div>
                      <Label htmlFor="country">Country</Label>
                      <Input
                        id="country"
                        value={formData.taxInfo.address.country}
                        onChange={(e) => setFormData({
                          ...formData,
                          taxInfo: {
                            ...formData.taxInfo,
                            address: {
                              ...formData.taxInfo.address,
                              country: e.target.value
                            }
                          }
                        })}
                      />
                    </div>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          )}
        </div>

        <div className="flex justify-end space-x-2 mt-6">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading ? 'Saving...' : 'Save Configuration'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}