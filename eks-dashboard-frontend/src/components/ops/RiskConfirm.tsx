import React from 'react';
import { Alert, Modal, Typography } from 'antd';
import type { ModalProps } from 'antd';
import './ops-ui.css';

const { Text } = Typography;

type RiskConfirmProps = Omit<ModalProps, 'children' | 'title'> & {
  title: React.ReactNode;
  environmentName?: string | null;
  resourceName?: string | null;
  impact: React.ReactNode;
  children?: React.ReactNode;
};

const RiskConfirm: React.FC<RiskConfirmProps> = ({
  title,
  environmentName,
  resourceName,
  impact,
  children,
  okText = '确认执行',
  cancelText = '取消',
  okButtonProps,
  ...modalProps
}) => (
  <Modal
    {...modalProps}
    title={title}
    okText={okText}
    cancelText={cancelText}
    okButtonProps={{ danger: true, ...okButtonProps }}
  >
    <div className="ops-risk-confirm__scope">
      {environmentName && <Text>目标环境：<Text strong>{environmentName}</Text></Text>}
      {resourceName && <Text>目标资源：<Text strong>{resourceName}</Text></Text>}
    </div>
    <Alert className="ops-risk-confirm__warning" type="warning" showIcon message="操作影响" description={impact} />
    {children}
  </Modal>
);

export default RiskConfirm;
