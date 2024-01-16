import { H2Title } from '@/ui/display/typography/components/H2Title';
import { Button } from '@/ui/input/button/components/Button';
import { useEmailPasswordResetLinkMutation } from '~/generated/graphql';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';

export const ChangePassword = () => {

  const { enqueueSnackBar } = useSnackBar();

  const [emailPasswordResetLink] = useEmailPasswordResetLinkMutation();

  const handlePasswordResetClick = async () => {

    try {
      const { data } = await emailPasswordResetLink();
      if (data?.emailPasswordResetLink?.status === 'success') {
        enqueueSnackBar('Password reset link has been sent to the email', {
          variant: 'success',
        });
      } else {
        enqueueSnackBar('There was some issue', {
          variant: 'error',
        });
      }

    } catch(error) {
      enqueueSnackBar((error as Error).message, {
        variant: 'error',
      });
    }
  };

  return (
    <>
      <H2Title
        title="Change Password"
        description="Receive an email containing password update link"
      />
      <Button
        onClick={handlePasswordResetClick}
        variant="secondary"
        title="Change Password"
      />
    </>
  );
};