import React, { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  CreditCard, 
  User, 
  Search, 
  Plus,
  CheckCircle,
  AlertCircle,
  DollarSign,
  History
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "convex/react";
import { api } from "@genni/convex-types";
import { useUser } from "@clerk/clerk-react";

interface CreditTransaction {
  _id: string;
  userId: string;
  type: "purchase" | "usage" | "refund" | "bonus";
  amount: number;
  description: string;
  balanceAfter: number;
  createdAt: number;
  userEmail?: string;
  userName?: string;
}

export function CreditManagement() {
  const [activeTab, setActiveTab] = useState("grant");
  const [targetEmail, setTargetEmail] = useState("");
  const [creditAmount, setCreditAmount] = useState("");
  const [reason, setReason] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [useCurrentUser, setUseCurrentUser] = useState(false);
  
  const { toast } = useToast();
  const { user: currentUser } = useUser();
  
  // Admin functions
  const grantBonusCredits = useMutation(api.users.admin.grantBonusCredits);
  const searchUsers = useMutation(api.users.admin.searchUsers);
  
  // Queries for recent transactions and user lookup
  const recentTransactions = useQuery(api.admin.queries.getRecentCreditTransactions, { limit: 10 });
  
  // State for user lookup
  const [foundUser, setFoundUser] = useState<any>(null);
  const [searchError, setSearchError] = useState("");

  const handleUserLookup = async () => {
    if (!targetEmail && !useCurrentUser) {
      setSearchError("Please enter an email address or select current user");
      return;
    }

    try {
      setIsLoading(true);
      setSearchError("");
      
      if (useCurrentUser && currentUser?.emailAddresses?.[0]?.emailAddress) {
        // Use current admin user
        setFoundUser({
          _id: "current_user",
          email: currentUser.emailAddresses[0].emailAddress,
          name: currentUser.fullName || currentUser.firstName || "Admin User",
          credits: "Loading...",
          plan: "admin"
        });
      } else if (targetEmail) {
        // Search for user by email
        const users = await searchUsers({ query: targetEmail, limit: 1 });
        
        if (users && users.length > 0) {
          setFoundUser(users[0]);
        } else {
          setSearchError("User not found. Please check the email address.");
          setFoundUser(null);
        }
      }
    } catch (error) {
      setSearchError("Failed to lookup user. Please try again.");
      setFoundUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGrantCredits = async () => {
    if (!foundUser) {
      toast({
        title: "Error",
        description: "Please find a user first",
        variant: "destructive"
      });
      return;
    }

    if (!creditAmount || parseInt(creditAmount) <= 0) {
      toast({
        title: "Error", 
        description: "Please enter a valid credit amount",
        variant: "destructive"
      });
      return;
    }

    if (!reason.trim()) {
      toast({
        title: "Error",
        description: "Please provide a reason for granting credits",
        variant: "destructive"
      });
      return;
    }

    try {
      setIsLoading(true);
      
      await grantBonusCredits({
        userId: foundUser._id,
        amount: parseInt(creditAmount),
        reason: reason.trim()
      });

      toast({
        title: "Credits Granted Successfully",
        description: `${creditAmount} credits have been added to ${foundUser.name || foundUser.email}'s account.`
      });

      // Reset form
      setCreditAmount("");
      setReason("");
      setFoundUser(null);
      setTargetEmail("");
      setUseCurrentUser(false);
      
    } catch (error: any) {
      toast({
        title: "Failed to Grant Credits",
        description: error.message || "An error occurred while granting credits",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  const renderGrantCreditsTab = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* User Selection */}
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <User className="h-5 w-5" />
            Select User
          </h3>
          
          <div className="space-y-4">
            {/* Toggle for current user vs email lookup */}
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <input
                  type="radio"
                  id="use-email"
                  checked={!useCurrentUser}
                  onChange={() => {
                    setUseCurrentUser(false);
                    setFoundUser(null);
                    setSearchError("");
                  }}
                  className="w-4 h-4"
                />
                <Label htmlFor="use-email" className="text-sm">
                  Use Email Address
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <input
                  type="radio"
                  id="use-current"
                  checked={useCurrentUser}
                  onChange={() => {
                    setUseCurrentUser(true);
                    setTargetEmail("");
                    setFoundUser(null);
                    setSearchError("");
                  }}
                  className="w-4 h-4"
                />
                <Label htmlFor="use-current" className="text-sm">
                  Current User (Me)
                </Label>
              </div>
            </div>

            {!useCurrentUser && (
              <div>
                <Label htmlFor="email">User Email Address</Label>
                <div className="flex gap-2 mt-1">
                  <Input
                    id="email"
                    type="email"
                    placeholder="user@example.com"
                    value={targetEmail}
                    onChange={(e) => setTargetEmail(e.target.value)}
                  />
                  <Button 
                    onClick={handleUserLookup}
                    disabled={isLoading || !targetEmail}
                    variant="outline"
                  >
                    <Search className="h-4 w-4 mr-2" />
                    Find
                  </Button>
                </div>
              </div>
            )}

            {useCurrentUser && (
              <div>
                <p className="text-sm text-muted-foreground mb-2">
                  Grant credits to yourself (admin user)
                </p>
                <Button 
                  onClick={handleUserLookup}
                  disabled={isLoading}
                  variant="outline"
                  className="w-full"
                >
                  <User className="h-4 w-4 mr-2" />
                  Select Current User
                </Button>
              </div>
            )}

            {searchError && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{searchError}</AlertDescription>
              </Alert>
            )}

            {foundUser && (
              <Alert>
                <CheckCircle className="h-4 w-4" />
                <AlertDescription>
                  <div className="space-y-1">
                    <div><strong>User:</strong> {foundUser.name || "Unknown"}</div>
                    <div><strong>Email:</strong> {foundUser.email}</div>
                    <div><strong>Current Credits:</strong> {foundUser.credits}</div>
                    <div><strong>Plan:</strong> 
                      <Badge variant="secondary" className="ml-2">
                        {foundUser.plan || "unknown"}
                      </Badge>
                    </div>
                  </div>
                </AlertDescription>
              </Alert>
            )}
          </div>
        </Card>

        {/* Credit Details */}
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Credit Details
          </h3>

          <div className="space-y-4">
            <div>
              <Label htmlFor="amount">Credit Amount</Label>
              <Input
                id="amount"
                type="number"
                placeholder="100"
                value={creditAmount}
                onChange={(e) => setCreditAmount(e.target.value)}
                min="1"
                className="mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Enter the number of credits to grant (positive number)
              </p>
            </div>

            <div>
              <Label htmlFor="reason">Reason</Label>
              <Textarea
                id="reason"
                placeholder="Testing admin functionality, bonus for good customer, etc."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="mt-1"
                rows={3}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Provide a clear reason for the credit grant (required for audit trail)
              </p>
            </div>

            <Button 
              onClick={handleGrantCredits}
              disabled={isLoading || !foundUser || !creditAmount || !reason}
              className="w-full"
            >
              <Plus className="h-4 w-4 mr-2" />
              {isLoading ? "Granting Credits..." : "Grant Credits"}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );

  const renderTransactionHistoryTab = () => (
    <Card className="p-6">
      <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
        <History className="h-5 w-5" />
        Recent Credit Transactions
      </h3>

      {!recentTransactions ? (
        <div className="text-center py-8 text-muted-foreground">
          Loading transactions...
        </div>
      ) : recentTransactions.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          No recent credit transactions found
        </div>
      ) : (
        <div className="space-y-3">
          {recentTransactions.map((transaction: CreditTransaction) => (
            <div 
              key={transaction._id}
              className="flex items-center justify-between p-3 border rounded-lg"
            >
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-full ${
                  transaction.type === 'bonus' ? 'bg-green-100' :
                  transaction.type === 'purchase' ? 'bg-blue-100' :
                  transaction.type === 'usage' ? 'bg-orange-100' :
                  'bg-gray-100'
                }`}>
                  {transaction.type === 'bonus' && <Plus className="h-4 w-4 text-green-600" />}
                  {transaction.type === 'purchase' && <DollarSign className="h-4 w-4 text-blue-600" />}
                  {transaction.type === 'usage' && <CreditCard className="h-4 w-4 text-orange-600" />}
                  {transaction.type === 'refund' && <CheckCircle className="h-4 w-4 text-gray-600" />}
                </div>
                <div>
                  <div className="font-medium">{transaction.description}</div>
                  <div className="text-sm text-muted-foreground">
                    {transaction.userName || transaction.userEmail || "Unknown User"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(transaction.createdAt).toLocaleString()}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className={`font-bold ${
                  transaction.amount > 0 ? 'text-green-600' : 'text-red-600'
                }`}>
                  {transaction.amount > 0 ? '+' : ''}{transaction.amount} credits
                </div>
                <div className="text-sm text-muted-foreground">
                  Balance: {transaction.balanceAfter}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Credit Management</h2>
        <p className="text-muted-foreground">
          Grant bonus credits to users and monitor credit transactions
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="grant">Grant Credits</TabsTrigger>
          <TabsTrigger value="history">Transaction History</TabsTrigger>
        </TabsList>

        <TabsContent value="grant" className="mt-6">
          {renderGrantCreditsTab()}
        </TabsContent>

        <TabsContent value="history" className="mt-6">
          {renderTransactionHistoryTab()}
        </TabsContent>
      </Tabs>
    </div>
  );
}