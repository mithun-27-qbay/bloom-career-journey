import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useMsg91 } from '@/hooks/useMsg91';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BookOpen, Users, GraduationCap } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { SchoolInfo, SchoolClass } from '@/integrations/supabase/types';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { REGEXP_ONLY_DIGITS } from 'input-otp';


export default function AuthPage() {
  console.log('AuthPage: Component rendering');
  
  const { user, userProfile, signIn, signUp } = useAuth();
  const { isReady, isVerifying, verifiedToken, openWidget, sendOtpCode, verifyOtpCode, verifyTokenWithBackend, resetVerification } = useMsg91();
  
  const [signInForm, setSignInForm] = useState({ identifier: '', password: '' });
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [signUpForm, setSignUpForm] = useState({ 
    identifier: '', 
    password: '', 
    fullName: '', 
    role: 'student' as 'teacher' | 'student',
    schoolId: '',
    classId: '',
    gender: '' as 'male' | 'female'
  });
  const [loading, setLoading] = useState(false);
  const [schools, setSchools] = useState<SchoolInfo[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [loadingSchools, setLoadingSchools] = useState(false);

  // MSG91: Determine if identifier is email or mobile
  const isEmail = signUpForm.identifier.includes('@');
  const isMobile = signUpForm.identifier.length >= 10 && !isEmail;

  // Reset verification if identifier changes
  useEffect(() => {
    resetVerification();
    setOtpSent(false);
    setOtpCode('');
  }, [signUpForm.identifier, resetVerification]);

  // Load schools on component mount
  useEffect(() => {
    console.log('AuthPage: useEffect triggered, calling loadSchools');
    loadSchools();
  }, []);

  // Load classes when school is selected
  useEffect(() => {
    if (signUpForm.schoolId) {
      loadClasses(signUpForm.schoolId);
    } else {
      setClasses([]);
    }
  }, [signUpForm.schoolId]);

  // Load schools (states) from database
  const loadSchools = async () => {
    console.log('Loading states as schools...');
    setLoadingSchools(true);
    try {
      // Primary attempt: using 'states' table which exists and has ILP data
      const { data, error } = await supabase
        .from('states')
        .select('id, name, state_code')
        .order('name');

      if (error) {
        console.error('States query failed:', error);
        // Fallback to minimal list if table missing (though we verified it EXISTS)
        setSchools([{ school_id: 'cef91711-ebd8-4552-b302-dfcfcdc382e0', school_name: 'ILP-Tamil Nadu', school_code: 'ILP-TN', org_name: '' }]);
        return;
      }

      const schoolsData = (data || []).map((state: any) => ({
        school_id: String(state.id),
        school_name: String(state.name || state.state_name),
        school_code: String(state.state_code || ''),
        org_name: ''
      }));
      setSchools(schoolsData);
    } catch (error) {
      console.error('Error loading schools:', error);
      setSchools([]);
    } finally {
      setLoadingSchools(false);
    }
  };

  // Load classes for selected school (state)
  const loadClasses = async (schoolId: string) => {
    try {
      console.log('Loading classes for state:', schoolId);
      
      // Filter by state_id (confirmed schema name)
      const { data, error } = await supabase
        .from('classes')
        .select('id, name')
        .eq('state_id', schoolId)
        .order('name');
        
      if (error) throw error;
      
      const rawClasses = (data || []).filter((r: any) => r && r.id && r.name);
      const uniqueClasses = Array.from(new Map(rawClasses.map((r: any) => [r.id, r])).values());
      const classesData = uniqueClasses.map((row: any) => ({
        class_id: String(row.id),
        class_name: String(row.name),
      }));
      setClasses(classesData);
    } catch (error) {
      console.error('Error loading classes:', error);
      setClasses([]);
    }
  };

  // Redirect if already authenticated
  if (user && userProfile) {
    const redirectPath = userProfile.role === 'admin' ? '/admin' 
                        : userProfile.role === 'teacher' ? '/teacher'
                        : '/student';
    return <Navigate to={redirectPath} replace />;
  }

  const handleSendOTP = async () => {
    if (!signUpForm.identifier || isEmail) return;
    const result = await sendOtpCode(signUpForm.identifier);
    console.log('[Auth] handleSendOTP result:', result);
    if (result.success) {
      setOtpSent(true);
    }
  };

  const handleVerifyOTP = async () => {
    if (!otpCode || otpCode.length < 4) return;
    const result = await verifyOtpCode(signUpForm.identifier, otpCode);
    if (result.success) {
      // verifiedToken is set to 'manual_verified' in the hook
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await signIn(signInForm.identifier, signInForm.password);
    setLoading(false);
    if (error) {
      console.error('Sign in error:', error);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    // 1. MSG91: Require OTP Verification for Mobile users
    if (isMobile) {
      if (!verifiedToken) {
        if (!otpSent) {
          console.log('[Auth] Mobile detected, calling handleSendOTP');
          await handleSendOTP();
          setLoading(false);
          return;
        } else {
          toast({
            title: "Verification Required",
            description: "Please enter and verify the 4-digit code first.",
            variant: "destructive"
          });
          setLoading(false);
          return;
        }
      }
      console.log('[Auth] OTP verification confirmed');
    }

    // Validate required fields based on role
    if (!signUpForm.schoolId) {
      console.error('School selection is required');
      setLoading(false);
      return;
    }
    
    if (signUpForm.role === 'student' && !signUpForm.classId) {
      console.error('Class selection is required for students');
      setLoading(false);
      return;
    }
    
    const email = isEmail ? signUpForm.identifier : null;
    const mobileValue = isMobile ? signUpForm.identifier : null;
    
    const { error } = await signUp(
      mobileValue, 
      email, 
      signUpForm.password, 
      signUpForm.fullName, 
      signUpForm.role,
      signUpForm.schoolId,
      signUpForm.classId,
      signUpForm.gender,
      !!verifiedToken // isMobileVerified
    );
    setLoading(false);
    if (error) {
      console.error('Sign up error:', error);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 via-background to-accent/5 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="mx-auto w-16 h-16 bg-gradient-to-r from-primary to-accent rounded-full flex items-center justify-center mb-4">
            <GraduationCap className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-foreground">CareerCompass</h1>
          <p className="text-muted-foreground mt-2">Navigate your career journey</p>
        </div>

        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle>Welcome</CardTitle>
            <CardDescription>Sign in to your account or create a new one</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="signin" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="signin">Sign In</TabsTrigger>
                <TabsTrigger value="signup">Sign Up</TabsTrigger>
              </TabsList>
              
              <TabsContent value="signin">
                <form onSubmit={handleSignIn} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="signin-identifier">Email or Mobile Number</Label>
                    <Input
                      id="signin-identifier"
                      type="text"
                      placeholder="Enter your email or mobile number"
                      value={signInForm.identifier}
                      onChange={(e) => setSignInForm({ ...signInForm, identifier: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signin-password">Password</Label>
                    <Input
                      id="signin-password"
                      type="password"
                      placeholder="Enter your password"
                      value={signInForm.password}
                      onChange={(e) => setSignInForm({ ...signInForm, password: e.target.value })}
                      required
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? 'Signing In...' : 'Sign In'}
                  </Button>
                </form>
              </TabsContent>
              
              <TabsContent value="signup">
                <form onSubmit={handleSignUp} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="signup-name">Full Name</Label>
                    <Input
                      id="signup-name"
                      type="text"
                      placeholder="Enter your full name"
                      value={signUpForm.fullName}
                      onChange={(e) => setSignUpForm({ ...signUpForm, fullName: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-identifier">Email Address / Mobile Number</Label>
                    <div className="flex gap-2">
                      <Input
                        id="signup-identifier"
                        type="text"
                        placeholder="Enter your email address or mobile number"
                        value={signUpForm.identifier}
                        onChange={(e) => setSignUpForm({ ...signUpForm, identifier: e.target.value })}
                        required
                        className="flex-1"
                      />
                      {isMobile && !verifiedToken && !otpSent && (
                        <Button 
                          type="button" 
                          variant="outline" 
                          onClick={handleSendOTP}
                          disabled={isVerifying}
                        >
                          Verify
                        </Button>
                      )}
                      {isMobile && !verifiedToken && otpSent && (
                        <Button 
                          type="button" 
                          variant="default" 
                          onClick={handleVerifyOTP}
                          disabled={isVerifying || otpCode.length < 4}
                        >
                          Confirm
                        </Button>
                      )}
                      {verifiedToken && (
                        <div className="flex items-center text-green-600 text-sm font-medium px-2 bg-green-50 rounded border border-green-200">
                          Verified ✓
                        </div>
                      )}
                    </div>
                  </div>

                  {isMobile && otpSent && !verifiedToken && (
                    <div className="space-y-4 py-4 px-2 bg-primary/5 rounded-lg border border-primary/20 animate-in fade-in slide-in-from-top-2">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="otp" className="font-semibold text-primary">Enter 4-Digit Verification Code</Label>
                        <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full uppercase font-bold tracking-wider">Required</span>
                      </div>
                      
                      <div className="flex justify-center py-2">
                        <InputOTP
                          maxLength={4}
                          value={otpCode}
                          onChange={(value) => setOtpCode(value)}
                          pattern={REGEXP_ONLY_DIGITS}
                        >
                          <InputOTPGroup className="gap-3">
                            <InputOTPSlot index={0} className="w-12 h-14 text-xl font-bold border-2" />
                            <InputOTPSlot index={1} className="w-12 h-14 text-xl font-bold border-2" />
                            <InputOTPSlot index={2} className="w-12 h-14 text-xl font-bold border-2" />
                            <InputOTPSlot index={3} className="w-12 h-14 text-xl font-bold border-2" />
                          </InputOTPGroup>
                        </InputOTP>
                      </div>
                      
                      <div className="flex justify-between items-center text-sm text-muted-foreground">
                        <p>Sent to <span className="font-medium text-foreground">+{signUpForm.identifier}</span></p>
                        <button 
                          type="button" 
                          onClick={handleSendOTP} 
                          className="text-primary font-medium hover:underline flex items-center gap-1"
                          disabled={isVerifying}
                        >
                          {isVerifying ? 'Sending...' : 'Resend Code'}
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="signup-password">Password</Label>
                    <Input
                      id="signup-password"
                      type="password"
                      placeholder="Create a password"
                      value={signUpForm.password}
                      onChange={(e) => setSignUpForm({ ...signUpForm, password: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="role">Role</Label>
                    <Select value={signUpForm.role} onValueChange={(value: 'teacher' | 'student') => setSignUpForm({ ...signUpForm, role: value, classId: '', schoolId: '' })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="student">
                          <div className="flex items-center gap-2">
                            <BookOpen className="w-4 h-4" />
                            Student
                          </div>
                        </SelectItem>
                        <SelectItem value="teacher">
                          <div className="flex items-center gap-2">
                            <Users className="w-4 h-4" />
                            Teacher
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* School Selection */}
                  <div className="space-y-2">
                    <Label htmlFor="school">School *</Label>
                    <Select 
                      value={signUpForm.schoolId} 
                      onValueChange={(value) => setSignUpForm({ ...signUpForm, schoolId: value, classId: '' })}
                      disabled={loadingSchools}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={loadingSchools ? "Loading schools..." : "Select your school"} />
                      </SelectTrigger>
                      <SelectContent>
                        {schools.length === 0 ? (
                          <>
                            {loadingSchools ? null : (
                              <div className="px-3 py-2 text-sm text-muted-foreground">No schools available</div>
                            )}
                          </>
                        ) : (
                          schools.map((school) => (
                            <SelectItem key={school.school_id} value={school.school_id}>
                              <div className="flex flex-col">
                                <span className="font-medium">{school.school_name}</span>
                                <span className="text-xs text-muted-foreground">{school.school_code}</span>
                              </div>
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Class Selection - Only for Students */}
                  {signUpForm.role === 'student' && (
                    <div className="space-y-2">
                      <Label htmlFor="class">Class *</Label>
                      <Select 
                        value={signUpForm.classId} 
                        onValueChange={(value) => setSignUpForm({ ...signUpForm, classId: value })}
                        disabled={!signUpForm.schoolId || classes.length === 0}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={!signUpForm.schoolId ? "Select school first" : classes.length === 0 ? "No classes available" : "Select your class"} />
                        </SelectTrigger>
                        <SelectContent>
                          {classes.map((classItem) => (
                            <SelectItem key={classItem.class_id} value={classItem.class_id}>
                              {classItem.class_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {/* Gender Selection - Only for Students */}
                  {signUpForm.role === 'student' && (
                    <div className="space-y-2">
                      <Label htmlFor="gender">Gender</Label>
                      <Select 
                        value={signUpForm.gender} 
                        onValueChange={(value: 'male' | 'female') => setSignUpForm({ ...signUpForm, gender: value })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select gender" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="male">Male</SelectItem>
                          <SelectItem value="female">Female</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? 'Creating Account...' : 'Create Account'}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}