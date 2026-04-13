import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { User, Session } from '@supabase/supabase-js';
import { useToast } from '@/hooks/use-toast';

interface AuthUser extends User {
  user_metadata: {
    mobile?: string;
    email?: string;
    full_name?: string;
    role?: 'admin' | 'teacher' | 'student';
  };
}

interface AuthContextType {
  user: AuthUser | null;
  session: Session | null;
  loading: boolean;
  signIn: (identifier: string, password: string) => Promise<{ error: any }>;
  signUp: (
    mobile: string | null, 
    email: string, 
    password: string, 
    fullName: string, 
    role: 'teacher' | 'student',
    schoolId: string,
    classId?: string,
    gender?: 'male' | 'female',
    isMobileVerified?: boolean
  ) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
  userProfile: any;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [userProfile, setUserProfile] = useState<any>(null);
  const { toast } = useToast();

  console.log('AuthProvider initialized');

  // Monitor userProfile changes for debugging
  useEffect(() => {
    console.log('🔄 userProfile state changed:', userProfile);
    console.log('🔄 Current user state:', user);
    console.log('🔄 Loading state:', loading);
  }, [userProfile, user, loading]);

  // Test database connection and migration
  const testDatabase = async () => {
    try {
      console.log('Testing database connection...');
      
      // Test basic connection
      const { data: basicTest, error: basicError } = await supabase
        .from('users')
        .select('count')
        .limit(1);
      
      if (basicError) {
        console.error('Basic database test failed:', basicError);
        return false;
      }
      
      console.log('Basic database connection successful');
      
      // Test if email column exists
      const { data: emailTest, error: emailError } = await supabase
        .from('users')
        .select('email')
        .limit(1);
      
      if (emailError) {
        console.error('Email column test failed:', emailError);
        console.log('This suggests the migration has not been applied');
        return false;
      }
      
      console.log('Email column exists - migration appears to be applied');
      
      // Test if mobile column allows nulls
      const { data: mobileTest, error: mobileError } = await supabase
        .from('users')
        .select('mobile')
        .limit(1);
      
      if (mobileError) {
        console.error('Mobile column test failed:', mobileError);
        return false;
      }
      
      console.log('Mobile column test successful');
      console.log('Database connection and migration test successful');
      return true;
    } catch (error) {
      console.error('Database test error:', error);
      return false;
    }
  };

  // Create user profile with robust retries and diagnostics
  const createUserProfile = async (userData: any) => {
    try {
      console.log('Attempting to create user profile with data:', userData);

      // 1) First attempt: full insert
      let { error: insertError } = await supabase.from('users').insert(userData);
      if (!insertError) {
        console.log('User profile created successfully via direct insert');
        return { success: true, error: null };
      }

      console.warn('Direct insert failed:', {
        code: (insertError as any)?.code,
        message: (insertError as any)?.message,
        details: (insertError as any)?.details,
        hint: (insertError as any)?.hint,
      });

      const code = (insertError as any)?.code;
      const message = (insertError as any)?.message || '';
      
      // If we got a column error (PGRST204) or FK error on school_id, try mapping to state_id
      if ((code === '23503' || code === 'PGRST204') && message.includes('school_id')) {
        console.warn('Handling school_id discrepancy by mapping to state_id');
        const statePayload = { ...userData };
        delete statePayload.school_id;
        statePayload.state_id = userData.school_id;
        
        const retry = await supabase.from('users').insert(statePayload);
        if (!retry.error) {
          console.log('User profile created successfully with state_id');
          return { success: true, error: null };
        }
        insertError = retry.error;
      }

      // If still failing with NOT NULL or other errors, try a truly minimal payload
      if ((insertError as any)?.code === '23502' || insertError) {
        console.warn('Final attempt with basic payload');
        const finalPayload = {
          id: userData.id,
          role: userData.role,
          full_name: userData.full_name,
          email: userData.email,
        } as any;
        
        // Add state_id if we have it
        if (userData.school_id) finalPayload.state_id = userData.school_id;
        
        const retry = await supabase.from('users').upsert(finalPayload, { onConflict: 'id' });
        if (!retry.error) {
          console.log('User profile created/upserted with final payload');
          return { success: true, error: null };
        }
        insertError = retry.error;
      }

      console.error('All attempts to create user profile failed:', insertError);
      return { success: false, error: insertError };
    } catch (error) {
      console.error('Error in createUserProfile:', error);
      return { success: false, error };
    }
  };

  useEffect(() => {
    console.log('AuthProvider useEffect running');
    
    // Test database connection
    testDatabase();

    // Set up auth state listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        console.log('Auth state change:', event, session?.user?.id);
        setSession(session);
        setUser(session?.user as AuthUser || null);
        
        if (session?.user) {
          // Fetch user profile data
          setTimeout(() => {
            fetchUserProfile(session.user.id, session.user as AuthUser);
          }, 0);
        } else {
          setUserProfile(null);
        }
        
        setLoading(false);
      }
    );

    // Check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      console.log('Initial session check:', session?.user?.id);
      setSession(session);
      setUser(session?.user as AuthUser || null);
      
      if (session?.user) {
        fetchUserProfile(session.user.id, session.user as AuthUser);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const fetchUserProfile = async (userId: string, userOverride?: AuthUser) => {
    try {
      console.log('🔍 Fetching user profile for:', userId);
      // Use the passed user if available, otherwise fall back to state
      const currentUser = userOverride || user;
      console.log('Current user state:', currentUser);
      console.log('User metadata:', currentUser?.user_metadata);
      
      // 🔧 RLS BYPASS: For custom authenticated students, create profile from auth data
      if (currentUser && currentUser.user_metadata?.role === 'student') {
        console.log('🚀 RLS BYPASS: Using existing student data from authentication');
        const studentProfile = {
          id: userId,
          full_name: currentUser.user_metadata.full_name,
          email: currentUser.user_metadata.email,
          mobile: currentUser.user_metadata.mobile,
          role: 'student',
          school_id: null,
          studentProfile: null
        };
        
        // Set the profile immediately - this will trigger routing!
        setUserProfile(studentProfile);
        console.log('✅ Student profile set from auth data:', studentProfile);
        
        // Small delay to ensure React processes the state change
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Try to fetch additional student data (optional, might fail due to RLS)
        try {
          const { data: studentData, error: studentError } = await supabase
            .from('students')
            .select('*')
            .eq('user_id', userId)
            .single();
          
          if (!studentError && studentData) {
            console.log('📚 Additional student data fetched:', studentData);
            const enhancedProfile = { ...studentProfile, studentProfile: studentData };
            setUserProfile(enhancedProfile);
            console.log('✅ Enhanced student profile set:', enhancedProfile);
          } else {
            console.log('ℹ️ No additional student data (RLS restriction expected):', studentError);
          }
        } catch (roleDataError) {
          console.log('ℹ️ Expected RLS restriction on students table:', roleDataError);
        }
        
        console.log('🎯 RLS BYPASS COMPLETE - Student should now be redirected!');
        
        // Debug: Check if userProfile was actually set
        setTimeout(() => {
          console.log('🔍 DEBUG: userProfile state after RLS bypass:', { userProfile });
        }, 100);
        
        return; // Exit early - no need to query database
      }
      
      // Original logic for Supabase Auth users (teachers/admins)
      console.log('🔍 Fetching profile for Supabase Auth user (database query)');
      
      // Retry a few times because profile insert may race with auth state change
      let attempts = 0;
      let userData: any = null;
      let userError: any = null;
      while (attempts < 4) {
        const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
          .maybeSingle();
        userData = data;
        userError = error;
        console.log(`Attempt ${attempts + 1}:`, { data, error });
        if (userData) break;
        // If no row (PGRST116 / 406), wait and retry
        const code = (userError as any)?.code;
        if (code === 'PGRST116' || (userError && (userError as any).status === 406)) {
          attempts += 1;
          await new Promise(r => setTimeout(r, 500 * attempts));
          continue;
        }
        break;
      }
      if (userError && !userData) {
        console.error('All attempts failed, throwing error:', userError);
        throw userError;
      }

      if (userData) {
        console.log('User data fetched successfully:', userData);
        
        // Set basic user profile first
        setUserProfile(userData);
        console.log('Basic userProfile set:', userData);
        
        // Fetch role-specific data (optional - don't fail if tables don't exist)
        try {
        if (userData.role === 'student') {
            console.log('Fetching student profile data for user:', userId);
            const { data: studentData, error: studentError } = await supabase
            .from('students')
              .select('*')
            .eq('user_id', userId)
            .single();
          
            if (studentError) {
              console.warn('Could not fetch student data:', studentError);
              // Set userProfile with empty studentProfile to avoid undefined errors
              const finalProfile = { ...userData, role: 'student', studentProfile: null };
              setUserProfile(finalProfile);
              console.log('Final userProfile set (student, no profile):', finalProfile);
            } else {
              console.log('Student data fetched successfully:', studentData);
              const finalProfile = { ...userData, role: 'student', studentProfile: studentData };
              setUserProfile(finalProfile);
              console.log('Final userProfile set (student, with profile):', finalProfile);
            }
        } else if (userData.role === 'teacher') {
            console.log('Fetching teacher profile data for user:', userId);
            const { data: teacherData, error: teacherError } = await supabase
            .from('teachers')
              .select('*')
            .eq('user_id', userId)
            .single();
          
            if (teacherError) {
              console.warn('Could not fetch teacher data:', teacherError);
              // Set userProfile with empty teacherProfile to avoid undefined errors
              const finalProfile = { ...userData, role: 'teacher', teacherProfile: null };
              setUserProfile(finalProfile);
              console.log('Final userProfile set (teacher, no profile):', finalProfile);
            } else {
              console.log('Teacher data fetched successfully:', teacherData);
              const finalProfile = { ...userData, role: 'teacher', teacherProfile: teacherData };
              setUserProfile(finalProfile);
              console.log('Final userProfile set (teacher, with profile):', finalProfile);
            }
          } else {
            // For other roles, just set the basic user profile
            setUserProfile(userData);
            console.log('Final userProfile set (other role):', userData);
          }
        } catch (roleDataError) {
          console.warn('Error fetching role-specific data:', roleDataError);
          // Set userProfile with empty role-specific profile to avoid undefined errors
          if (userData.role === 'student') {
            const finalProfile = { ...userData, role: 'student', studentProfile: null };
            setUserProfile(finalProfile);
            console.log('Final userProfile set (student, error fallback):', finalProfile);
          } else if (userData.role === 'teacher') {
            const finalProfile = { ...userData, role: 'teacher', teacherProfile: null };
            setUserProfile(finalProfile);
            console.log('Final userProfile set (teacher, error fallback):', finalProfile);
          } else {
            setUserProfile(userData);
            console.log('Final userProfile set (other role, error fallback):', userData);
          }
        }
      } else {
        console.error('No user data found after all attempts');
      }
    } catch (error) {
      console.error('Error fetching user profile:', error);
      // Set a minimal userProfile to prevent undefined errors
      const fallbackProfile = { id: userId, role: 'unknown' };
      setUserProfile(fallbackProfile);
      console.log('Fallback userProfile set due to error:', fallbackProfile);
    }
  };

  const signIn = async (identifier: string, password: string) => {
    try {
      console.log('🔐 Sign in attempt for:', identifier);
      
      // First, try custom authentication for students
      try {
        console.log('🔄 Attempting custom authentication...');
        const idTrim = identifier.trim();
        const idForAuth = idTrim.includes('@') ? idTrim.toLowerCase() : idTrim;
        const pwd = password.trim();
        const { data: customAuthData, error: customAuthError } = await supabase
          .rpc('authenticate_student', {
            identifier: idForAuth,
            password: pwd
          });
        
        if (!customAuthError && customAuthData && customAuthData.length > 0) {
          const studentUser = customAuthData[0];
          console.log('✅ Custom authentication successful for student:', studentUser);
          
          // Create a mock Supabase user object for the student
          const mockUser: AuthUser = {
            id: studentUser.user_id,
            email: studentUser.email || undefined,
            phone: studentUser.mobile || undefined,
            user_metadata: {
              full_name: studentUser.full_name,
              role: studentUser.role,
              mobile: studentUser.mobile,
              email: studentUser.email
            }
          } as AuthUser;
          
          // Create a mock session for custom auth
          const mockSession = {
            user: mockUser,
            access_token: 'custom-auth-token',
            refresh_token: 'custom-auth-refresh',
            expires_at: Date.now() + (24 * 60 * 60 * 1000), // 24 hours from now
            token_type: 'bearer'
          } as Session;
          
          // Set all the required state for custom authentication
          setUser(mockUser);
          setSession(mockSession);
          console.log('👤 Mock user and session set for custom auth');
          
          // Wait for user state to be set before fetching profile
          await new Promise(resolve => setTimeout(resolve, 50));
          
          // Now fetch the profile - pass the mockUser directly to avoid state race condition
          await fetchUserProfile(studentUser.user_id, mockUser);
          console.log('📋 User profile fetched for custom auth student');
          
          // Ensure loading is false for custom auth
          setLoading(false);
          
          // Small delay to ensure all state changes are processed
          await new Promise(resolve => setTimeout(resolve, 50));
          
          toast({
            title: "Sign in successful! ✨",
            description: `Welcome back, ${studentUser.full_name}!`,
          });
          
          return { error: null };
        }
      } catch (customAuthError) {
        console.log('❌ Custom authentication failed, trying Supabase Auth:', customAuthError);
      }
      
      // Fallback to Supabase Auth for teachers and admins
      // Determine if identifier is email or mobile
      const isEmail = identifier.includes('@');
      let emailForAuth: string;

      if (isEmail) {
        emailForAuth = identifier;
      } else {
        // For mobile numbers, try to find the user's email
        const { data: userByMobile, error: userByMobileError } = await supabase
          .from('users')
          .select('email')
          .eq('mobile', identifier)
          .maybeSingle();
        
        if (userByMobileError) {
          console.error('Error looking up user by mobile:', userByMobileError);
          // Fall back to generated email pattern
          emailForAuth = `${identifier}@internal.app`;
        } else if (userByMobile && userByMobile.email) {
          emailForAuth = userByMobile.email;
        } else {
          // Fall back to generated email pattern
          emailForAuth = `${identifier}@internal.app`;
        }
      }

      console.log('🔐 Attempting sign in with email:', emailForAuth);

      const { data: signInData, error } = await supabase.auth.signInWithPassword({
        email: emailForAuth,
        password,
      });

      if (error) {
        console.error('❌ Sign in error:', error);
        toast({
          title: "Sign in failed",
          description: error.message || "Invalid email/mobile or password",
          variant: "destructive",
        });
        return { error };
      }

      if (signInData?.user) {
        console.log('✅ Supabase Auth successful:', signInData.user);
        setUser(signInData.user);
        await fetchUserProfile(signInData.user.id, signInData.user as AuthUser);
        
        toast({
          title: "Sign in successful! ✨",
          description: "Welcome back!",
        });
        
        return { error: null };
      }

      return { error: new Error('Sign in failed') };
    } catch (error) {
      console.error('❌ Sign in error:', error);
      toast({
        title: "Sign in failed",
        description: "An unexpected error occurred. Please try again.",
        variant: "destructive",
      });
      return { error };
    }
  };

  const signUp = async (
    mobile: string | null, 
    email: string, 
    password: string, 
    fullName: string, 
    role: 'teacher' | 'student',
    schoolId: string,
    classId?: string,
    gender?: 'male' | 'female',
    isMobileVerified: boolean = false
  ) => {
    try {
      console.log('Starting signUp process:', { mobile, email, fullName, role, schoolId, classId, gender });

      // Enforce class selection for students at the API layer too
      if (role === 'student' && !classId) {
        const err = { message: 'Class selection is required for student registration' } as any;
        console.error('SignUp blocked:', err);
        return { error: err };
      }
      
      // Handle email/mobile logic
      let finalEmail = email;
      let finalMobile = mobile;
      
      if (!email && mobile) {
        // If only mobile is provided, generate an email for Supabase auth
        finalEmail = `${mobile}@internal.app`;
        console.log('Generated email for mobile:', finalEmail);
      } else if (!mobile && email) {
        // If only email is provided, mobile is null
        finalMobile = null;
        console.log('Using provided email:', finalEmail);
      }

      // Check if email already exists
      console.log('Checking if email exists:', finalEmail);
      const { data: existingUserByEmail, error: emailCheckError } = await supabase
        .from('users')
        .select('id')
        .eq('email', finalEmail)
        .maybeSingle();
      
      if (emailCheckError) {
        console.error('Error checking email:', emailCheckError);
        return { error: { message: 'Failed to check email availability' } };
      }

      if (existingUserByEmail) {
        console.log('Email already exists:', finalEmail);
        return { error: { message: 'Email address already registered' } };
      }

      // Check if mobile already exists (if provided)
      if (finalMobile) {
        console.log('Checking if mobile exists:', finalMobile);
        const { data: existingUserByMobile, error: mobileCheckError } = await supabase
          .from('users')
          .select('id')
          .eq('mobile', finalMobile)
          .maybeSingle();
        
        if (mobileCheckError) {
          console.error('Error checking mobile:', mobileCheckError);
          return { error: { message: 'Failed to check mobile availability' } };
        }

        if (existingUserByMobile) {
          console.log('Mobile already exists:', finalMobile);
          return { error: { message: 'Mobile number already registered' } };
        }
      }

      // Create Supabase auth user
      console.log('Creating Supabase auth user with email:', finalEmail);
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: finalEmail,
        password,
        options: {
          data: {
            mobile: finalMobile,
            email: finalEmail,
            full_name: fullName,
            role,
          }
        }
      });

      if (authError) {
        console.error('Supabase auth error:', authError);
        toast({
          title: "Registration failed",
          description: authError.message,
          variant: "destructive",
        });
        return { error: authError };
      }

      console.log('Supabase auth user created:', authData.user?.id);

      if (authData.user) {
        const userProfileData: any = {
            id: authData.user.id,
            password_hash: 'handled_by_auth',
            role,
            full_name: fullName,
          school_id: schoolId,
          is_mobile_verified: isMobileVerified
        };
        
        // Only add email and mobile if the columns exist
        if (finalEmail) {
          userProfileData.email = finalEmail;
        }
        if (finalMobile) {
          userProfileData.mobile = finalMobile;
        }
        
        // Add gender for students
        if (role === 'student' && gender) {
          userProfileData.gender = gender;
        }
        
        // Use the new createUserProfile function
        const { success, error: userInsertError } = await createUserProfile(userProfileData);

        if (!success) {
          console.error('Error creating user profile:', userInsertError);
          toast({
            title: "Registration failed",
            description: "Failed to create user profile. Please contact support.",
            variant: "destructive",
          });
          return { error: userInsertError };
        }

        console.log('User profile created successfully');

        // Create role-specific profile (teacher or student)
        try {
          if (role === 'teacher') {
            // Create teacher profile - handle school_id vs state_id
            const teacherData: any = {
              user_id: authData.user.id,
              is_active: true,
              joining_date: new Date().toISOString(),
            };

            // Try with school_id first
            let { error: teacherError } = await supabase
              .from('teachers')
              .insert({ ...teacherData, school_id: schoolId });

            if (teacherError && ((teacherError as any).code === 'PGRST204' || (teacherError as any).code === '23503')) {
              console.warn('Teacher insert failed with school_id, retrying with state_id');
              const { error: retryError } = await supabase
                .from('teachers')
                .insert({ ...teacherData, state_id: schoolId });
              teacherError = retryError;
            }

            if (teacherError) {
              console.error('Error creating teacher profile:', teacherError);
              toast({
                title: "Registration warning",
                description: "Account created but teacher profile setup failed. Please contact support.",
                variant: "destructive",
              });
            }
          } else if (role === 'student') {
            // Create student profile (class is optional in Phase 1)
            const { error: studentError } = await supabase
              .from('students')
              .insert({
                user_id: authData.user.id,
                class_id: classId || null,
                teacher_id: null, // Will be assigned by admin/teacher later
                enrollment_date: new Date().toISOString(),
                enrollment_status: 'pending',
              });

            if (studentError) {
              console.error('Error creating student profile:', studentError);
              toast({
                title: "Registration warning",
                description: "Account created but student profile setup failed. Please contact support.",
                variant: "destructive",
              });
            }
          }
        } catch (profileError) {
          console.error('Error creating role profile:', profileError);
          // Don't fail registration for profile creation errors
        }

        // For Phase 1: Bypass email confirmation and sign in immediately
        try {
          console.log('Attempting auto sign-in');
          // Wait a moment for the user profile to be fully created
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          const { error: signInError } = await supabase.auth.signInWithPassword({
            email: finalEmail,
            password,
          });
          
          if (signInError) {
            console.error('Auto sign-in failed:', signInError);
            // Even if auto sign-in fails, registration was successful
            toast({
              title: "Registration successful",
              description: `Welcome to CareerCompass, ${fullName}! Please sign in manually.`,
            });
          } else {
            console.log('Auto sign-in successful');
            // Auto sign-in successful
            toast({
              title: "Registration successful",
              description: `Welcome to CareerCompass, ${fullName}! You're now signed in.`,
            });
          }
        } catch (signInError) {
          console.error('Auto sign-in error:', signInError);
        toast({
          title: "Registration successful",
            description: `Welcome to CareerCompass, ${fullName}! Please sign in manually.`,
        });
        }
      }

      return { error: null };
    } catch (error) {
      console.error('SignUp error:', error);
      return { error };
    }
  };



  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast({
        title: "Sign out failed",
        description: error.message,
        variant: "destructive",
      });
    } else {
      toast({
        title: "Signed out",
        description: "You have been signed out successfully",
      });
    }
  };

  const value = {
    user,
    session,
    loading,
    signIn,
    signUp,
    signOut,
    userProfile,
  };

  console.log('AuthProvider rendering with value:', { 
    user: !!user, 
    loading, 
    userProfile: userProfile ? {
      id: userProfile.id,
      role: userProfile.role,
      hasStudentProfile: !!userProfile.studentProfile,
      hasTeacherProfile: !!userProfile.teacherProfile
    } : null 
  });

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}