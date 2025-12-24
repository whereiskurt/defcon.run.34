'use client';

import { ReactNode } from 'react';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
} from '@heroui/react';

export interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string | ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmColor?: 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'danger';
  confirmVariant?: 'solid' | 'bordered' | 'light' | 'flat' | 'faded' | 'shadow' | 'ghost';
  cancelColor?: 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'danger';
  cancelVariant?: 'solid' | 'bordered' | 'light' | 'flat' | 'faded' | 'shadow' | 'ghost';
  isLoading?: boolean;
  icon?: ReactNode;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl' | 'full';
}

export default function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmColor = 'danger',
  confirmVariant = 'solid',
  cancelColor = 'default',
  cancelVariant = 'light',
  isLoading = false,
  icon,
  size = 'sm',
}: ConfirmDialogProps) {
  const handleConfirm = () => {
    onConfirm();
  };

  const handleClose = () => {
    if (!isLoading) {
      onClose();
    }
  };

  return (
    <Modal
      size={size}
      placement="center"
      isOpen={isOpen}
      backdrop="blur"
      onClose={handleClose}
      isDismissable={!isLoading}
    >
      <ModalContent>
        {() => (
          <>
            <ModalHeader className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                {icon}
                <span>{title}</span>
              </div>
            </ModalHeader>
            <ModalBody>
              {typeof message === 'string' ? <p>{message}</p> : message}
            </ModalBody>
            <ModalFooter>
              <Button
                color={cancelColor}
                variant={cancelVariant}
                onPress={handleClose}
                isDisabled={isLoading}
              >
                {cancelLabel}
              </Button>
              <Button
                color={confirmColor}
                variant={confirmVariant}
                onPress={handleConfirm}
                isLoading={isLoading}
              >
                {confirmLabel}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
